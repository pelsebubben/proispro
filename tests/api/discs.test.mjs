import assert from 'node:assert/strict'
import { Agent, createServer, request as httpRequest } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import sharp from 'sharp'
import { createPool, asUser } from '../../server/database.mjs'
import { migrate, schemaVersion } from '../../server/migrate.mjs'
import { createApplication } from '../../server/app.mjs'

test('real PostgreSQL API enforces signed identity, ownership, RLS and persistence', async t => {
  const admin = createPool()
  const password = process.env.PGAPP_PASSWORD
  t.after(() => admin.end())
  await migrate(admin, password)
  await migrate(admin, password)
  const runtime = createPool({ ...process.env, PGUSER: 'griplock_app', PGPASSWORD: password })
  t.after(() => runtime.end())
  const roles = await admin.query("SELECT rolbypassrls,rolsuper FROM pg_roles WHERE rolname='griplock_app'")
  assert.deepEqual(roles.rows, [{ rolbypassrls: false, rolsuper: false }])
  await migrate(admin, password, 'griplock_alt_app')
  const devRole = await admin.query(`SELECT r.rolbypassrls, r.rolsuper, r.rolcreaterole,
    has_table_privilege('griplock_alt_app', 'owned_discs', 'DELETE') AS deletes
    FROM pg_roles r WHERE r.rolname = 'griplock_alt_app'`)
  assert.deepEqual(devRole.rows, [{ rolbypassrls: false, rolsuper: false, rolcreaterole: false, deletes: true }])
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'integration-key', alg: 'RS256', use: 'sig' }
  const identityServer = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  }).listen(0, '127.0.0.1')
  await once(identityServer, 'listening')
  t.after(() => new Promise(resolve => identityServer.close(resolve)))
  const issuer = `http://127.0.0.1:${identityServer.address().port}`
  const app = createApplication({ pool: runtime, issuer, audience: 'griplock-test',
    jwksUrl: `${issuer}/jwks`, requiredScope: 'access_as_user', sourceSha: 'integration' }).listen(0, '127.0.0.1')
  await once(app, 'listening')
  t.after(() => new Promise(resolve => app.close(resolve)))
  const base = `http://127.0.0.1:${app.address().port}`
  const token = (subject, audience = 'griplock-test', expiry = '5m', scope = 'access_as_user') => new SignJWT({ scp: scope })
    .setProtectedHeader({ alg: 'RS256', kid: 'integration-key' }).setIssuer(issuer)
    .setSubject(subject).setAudience(audience).setExpirationTime(expiry).sign(privateKey)
  const alice = await token(randomUUID())
  const bob = await token(randomUUID())
  const request = (path, jwt, method = 'GET', body) => fetch(`${base}${path}`, {
    method, headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  assert.equal((await request('/health/ready')).status, 200)
  assert.equal((await request('/api/v1/discs')).status, 401)
  assert.equal((await request('/api/v1/discs', 'not-a-token')).status, 401)
  assert.equal((await request('/api/v1/discs', await token('alice', 'wrong'))).status, 401)
  assert.equal((await request('/api/v1/discs', await token('alice', 'griplock-test', '-1s'))).status, 401)
  for (const scope of ['', 'other_scope', 'prefix_access_as_user', 'access_as_user_extra']) {
    const denied = await request('/api/v1/discs', await token('alice', 'griplock-test', '5m', scope))
    assert.equal(denied.status, 403)
    assert.deepEqual(await denied.json(), { error: 'insufficient_scope' })
  }
  assert.equal((await request('/api/v1/discs', alice, 'POST', { name: '' })).status, 400)
  const created = await request('/api/v1/discs', alice, 'POST', { name: 'API fixture', manufacturer: 'Test' })
  assert.equal(created.status, 201)
  const disc = await created.json()
  assert.match(disc.id, /^[0-9a-f-]{36}$/)
  assert.equal((await (await request('/api/v1/discs', alice)).json()).discs[0].name, 'API fixture')
  assert.deepEqual((await (await request('/api/v1/discs', bob)).json()).discs, [])
  assert.equal((await request(`/api/v1/discs/${disc.id}`, bob, 'PATCH', { name: 'stolen' })).status, 404)
  assert.equal((await request(`/api/v1/discs/${disc.id}`, bob, 'DELETE')).status, 404)
  const ownerId = (await (await request('/api/v1/session', alice)).json()).userId
  const otherId = (await (await request('/api/v1/session', bob)).json()).userId
  const create = async (resource, body) => {
    const response = await request(`/api/v1/${resource}`, alice, 'POST', body)
    assert.equal(response.status, 201, `${resource}: ${await response.clone().text()}`)
    return response.json()
  }
  const rows = async (resource, jwt = alice) => (await (await request(`/api/v1/${resource}`, jwt)).json())[resource]
  const remove = async (resource, id) => assert.equal((await request(`/api/v1/${resource}/${id}`, alice, 'DELETE')).status, 200)
  assert.equal((await request(`/api/v1/discs/${disc.id}`, alice, 'PATCH', {
    speed: 9.5, turn: -1.5, weight: 173.5, disc_type: 'fairway', tags: ['test'], quantity: 2,
  })).status, 200)
  const fullDisc = (await rows('discs'))[0]
  assert.equal(Number(fullDisc.speed), 9.5)
  assert.equal(fullDisc.quantity, 2)
  assert.deepEqual(fullDisc.tags, ['test'])
  for (const body of [{ user_id: otherId }, { quantity: 0 }, { speed: 'fast' }, { extra: true }, { name: 'x'.repeat(201) }]) {
    assert.equal((await request(`/api/v1/discs/${disc.id}`, alice, 'PATCH', body)).status, 400)
  }
  const tooLarge = await request('/api/v1/discs', alice, 'POST', { name: 'x', notes: 'a'.repeat(17000) })
  assert.equal(tooLarge.status, 413)
  const bag = await create('bags', { name: 'Round bag' })
  assert.equal((await request(`/api/v1/bags/${bag.id}`, alice, 'PATCH', { disc_ids: [disc.id] })).status, 200)
  assert.equal((await rows('bag_history'))[0].action, 'added')
  assert.equal((await request(`/api/v1/bags/${bag.id}`, alice, 'PATCH', { disc_ids: [randomUUID()] })).status, 400)
  const collection = await create('collections', { name: 'Favorites', description: 'Test' })
  const membership = await create('collection_discs', { collection_id: collection.id, disc_id: disc.id })
  const wish = await create('wishlist_items', { disc_name: 'Wish', priority: 2, weight_min: 170, weight_max: 175 })
  assert.equal((await request(`/api/v1/wishlist_items/${wish.id}`, alice, 'PATCH', { acquired: true })).status, 200)
  const pin = await create('course_pins', { course_name: 'Test course', course_id: null, bag_id: bag.id })
  const hole = await create('hole_assignments', { course_pin_id: pin.id, hole_ref: '1', disc_id: disc.id, disc_name: fullDisc.name })
  const listing = await create('forsale_listings', { disc_id: disc.id, disc_name: fullDisc.name, disc_weight: '173.5' })
  const sold = await create('forsale_listings', { disc_id: disc.id, disc_name: 'Sold disc', status: 'sold' })
  const share = await create('sale_tokens', {})
  assert.equal((await create('sale_tokens', {})).token, share.token, 'ensuring a token is idempotent')
  const publicPath = `/api/v1/public/sales/${share.token}`
  assert.equal((await request(publicPath)).status, 404)
  assert.equal((await request(`/api/v1/sale_tokens/${share.id}`, alice, 'PATCH', { is_public: true })).status, 200)
  const publicResponse = await request(publicPath)
  assert.equal(publicResponse.status, 200)
  const publicRows = (await publicResponse.json()).listings
  assert.equal(publicRows.length, 1)
  assert.equal(publicRows[0].disc_name, fullDisc.name)
  assert.equal(Object.hasOwn(publicRows[0], 'user_id'), false)
  assert.equal(Object.hasOwn(publicRows[0], 'disc_id'), false)
  assert.equal((await request(`/api/v1/public/sales/${randomUUID()}`)).status, 404)
  for (const [resource, record] of Object.entries({ bags: bag, collections: collection, collection_discs: membership,
    wishlist_items: wish, course_pins: pin, hole_assignments: hole, forsale_listings: listing, sale_tokens: share })) {
    assert.deepEqual(await rows(resource, bob), [], `${resource} must be private`)
    assert.equal((await request(`/api/v1/${resource}/${record.id}`, bob, 'DELETE')).status, 404)
    const field = resource === 'sale_tokens' ? { is_public: true }
      : resource === 'wishlist_items' ? { acquired: true }
      : resource === 'forsale_listings' ? { status: 'sold' }
      : resource === 'course_pins' ? { course_name: 'Stolen' }
      : resource === 'hole_assignments' ? { disc_name: 'Stolen' }
      : resource === 'collection_discs' ? { disc_id: disc.id } : { name: 'Stolen' }
    assert.equal((await request(`/api/v1/${resource}/${record.id}`, bob, 'PATCH', field)).status, 404)
    const raw = await asUser(runtime, otherId, client => client.query(`SELECT * FROM ${resource}`))
    assert.equal(raw.rowCount, 0, `${resource} RLS rejects unfiltered reads`)
  }
  assert.equal((await request('/api/v1/collection_discs', bob, 'POST', { collection_id: collection.id, disc_id: disc.id })).status, 400)
  assert.equal((await request('/api/v1/course_pins', bob, 'POST', { course_name: 'Stolen', bag_id: bag.id })).status, 400)
  assert.equal((await request('/api/v1/forsale_listings', bob, 'POST', { disc_id: disc.id, disc_name: 'Stolen' })).status, 400)
  assert.equal((await request(`/api/v1/sale_tokens/${share.id}`, alice, 'PATCH', { is_public: false })).status, 200)
  assert.equal((await request(publicPath)).status, 404)
  await remove('collections', collection.id)
  assert.deepEqual(await rows('collection_discs'), [])
  await remove('bags', bag.id)
  assert.deepEqual(await rows('bag_history'), [])
  assert.deepEqual(await rows('course_pins'), [])
  assert.deepEqual(await rows('hole_assignments'), [])
  await remove('wishlist_items', wish.id)
  await remove('forsale_listings', listing.id)
  await remove('forsale_listings', sold.id)
  await remove('sale_tokens', share.id)
  // Prove RLS even when a caller accidentally omits the ownership predicate.
  const leaked = await asUser(runtime, otherId, client => client.query('SELECT * FROM owned_discs'))
  assert.equal(leaked.rowCount, 0)
  await assert.rejects(asUser(runtime, otherId, client => client.query(
    'INSERT INTO owned_discs (user_id,name) VALUES ($1,$2)', [ownerId, 'cross-user'])), /row-level security/)
  for (let index = 0; index < 10; index++) {
    const rows = await asUser(runtime, index % 2 ? otherId : ownerId, client => client.query('SELECT * FROM owned_discs'))
    assert.equal(rows.rowCount, index % 2 ? 0 : 1)
  }
  const withoutContext = await runtime.query('SELECT * FROM owned_discs')
  assert.equal(withoutContext.rowCount, 0, 'transaction context must not leak into pooled connections')
  assert.equal((await request(`/api/v1/discs/${disc.id}`, alice, 'PATCH', { name: 'Updated' })).status, 200)
  assert.equal((await (await request('/api/v1/discs', alice)).json()).discs[0].name, 'Updated')
  assert.equal((await request(`/api/v1/discs/${disc.id}`, alice, 'DELETE')).status, 200)
  assert.deepEqual((await (await request('/api/v1/discs', alice)).json()).discs, [])
  await admin.query('DELETE FROM app_users WHERE id = ANY($1::uuid[])', [[ownerId, otherId]])
})

const authScheme = ['Bear', 'er'].join('')
const authorization = jwt => `${authScheme} ${jwt}`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const dataUrl = bytes => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`
const pad = (bytes, size) => Buffer.concat([bytes, Buffer.alloc(size - bytes.length)])
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const flatJpeg = (width, height) => sharp({ create: { width, height, channels: 3, background: '#3366aa' } })
  .jpeg({ quality: 80 }).toBuffer()
// A flat colour with a small noisy patch: unique per call, but only a few KiB.
async function makePhoto(width, height, metadata) {
  const patch = await sharp(randomBytes(120 * 80 * 3), { raw: { width: 120, height: 80, channels: 3 } }).png().toBuffer()
  const image = sharp({ create: { width, height, channels: 3, background: '#3366aa' } })
    .composite([{ input: patch, left: 10, top: 10 }])
  return (metadata ? image.withMetadata(metadata) : image).jpeg({ quality: 85 }).toBuffer()
}
// Only a hung server ever reaches this limit: a healthy run answers in milliseconds and is cut off after about a
// second. It is generous because a starved machine can pause the whole process (client and server) for seconds.
const patienceMs = 30_000
const within = (ms, promise, message) => {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(typeof message === 'function' ? message() : message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}
// Answers as [status, error code or body], so a failing assertion shows what the server actually said.
const outcome = async response => {
  const body = await response.json()
  return [response.status, body.error ?? body]
}

// One application, signing key and database pool per test; everything it created is removed afterwards.
async function startApi(t) {
  const cleanups = []
  t.after(async () => {
    const failures = []
    for (const cleanup of cleanups.toReversed()) {
      try { await cleanup() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'test cleanup failed')
  })
  const password = process.env.PGAPP_PASSWORD
  const admin = createPool()
  cleanups.push(() => admin.end())
  await migrate(admin, password)
  const runtime = createPool({ ...process.env, PGUSER: 'griplock_app', PGPASSWORD: password })
  cleanups.push(() => runtime.end())
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'photo-key', alg: 'RS256', use: 'sig' }
  const identityServer = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  }).listen(0, '127.0.0.1')
  await once(identityServer, 'listening')
  cleanups.push(() => new Promise(resolve => { identityServer.closeAllConnections(); identityServer.close(resolve) }))
  const issuer = `http://127.0.0.1:${identityServer.address().port}`
  const app = createApplication({ pool: runtime, issuer, audience: 'griplock-test',
    jwksUrl: `${issuer}/jwks`, requiredScope: 'access_as_user', sourceSha: 'integration' }).listen(0, '127.0.0.1')
  await once(app, 'listening')
  cleanups.push(() => new Promise(resolve => { app.closeAllConnections(); app.close(resolve) }))
  const port = app.address().port
  const token = (subject, audience = 'griplock-test', expiry = '5m', scope = 'access_as_user') => new SignJWT({ scp: scope })
    .setProtectedHeader({ alg: 'RS256', kid: 'photo-key' }).setIssuer(issuer)
    .setSubject(subject).setAudience(audience).setExpirationTime(expiry).sign(privateKey)
  const request = (path, jwt, method = 'GET', body) => fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { ...(jwt ? { Authorization: authorization(jwt) } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  })
  const call = async (jwt, method, path, body, status = 200) => {
    const response = await request(path, jwt, method, body)
    const raw = await response.text()
    assert.equal(response.status, status, `${method} ${path}: ${raw.slice(0, 300)}`)
    return JSON.parse(raw)
  }
  const photoOf = async (jwt, discId, query = '') => {
    const response = await request(`/api/v1/discs/${discId}/photo${query}`, jwt)
    const bytes = Buffer.from(await response.arrayBuffer())
    const json = response.headers.get('content-type')?.startsWith('application/json')
    return { status: response.status, headers: response.headers, bytes, body: json ? JSON.parse(bytes.toString('utf8')) : null }
  }
  const users = []
  cleanups.push(async () => {
    for (const userId of users) {
      await asUser(runtime, userId, client => client.query('DELETE FROM owned_discs WHERE user_id = $1', [userId]))
    }
    if (users.length) await admin.query('DELETE FROM app_users WHERE id = ANY($1::uuid[])', [users])
  })
  const mintUser = async () => {
    const jwt = await token(randomUUID())
    const { userId } = await call(jwt, 'GET', '/api/v1/session')
    users.push(userId)
    return { jwt, userId }
  }
  // What a client could observe about one disc: its inventory row and a digest of the stored photo bytes.
  const snapshot = async (user, discId) => {
    const { discs } = await call(user.jwt, 'GET', '/api/v1/discs')
    const stored = await asUser(runtime, user.userId, client => client.query('SELECT image FROM disc_photos WHERE disc_id = $1', [discId]))
    return { disc: discs.find(row => row.id === discId) ?? null, image: stored.rows[0] ? digest(stored.rows[0].image) : null }
  }
  return { admin, runtime, port, token, request, call, photoOf, mintUser, snapshot }
}

test('a disc photo and edition are created, kept, replaced and removed through the API', async t => {
  const { request, call, photoOf, runtime, mintUser } = await startApi(t)
  const alice = await mintUser()
  const stored = async id => (await asUser(runtime, alice.userId, client => client.query(
    'SELECT user_id, image FROM disc_photos WHERE disc_id = $1', [id]))).rows
  const source = await makePhoto(1600, 1200, { orientation: 6, exif: { IFD0: { Copyright: 'secret-copyright' } } })
  assert.ok(source.includes(Buffer.from('secret-copyright')), 'the fixture must carry metadata to strip')

  const created = await call(alice.jwt, 'POST', '/api/v1/discs', { name: 'Photo disc', manufacturer: 'Discraft',
    disc_type: 'Utility', edition: 'Origin / Midnight Prowl 2', photo: dataUrl(source) }, 201)
  assert.deepEqual([created.edition, created.disc_type, created.user_photo_url], ['Origin / Midnight Prowl 2', 'Utility', null])
  assert.match(created.photo_version, uuidPattern)
  for (const key of ['photo', 'image']) assert.equal(Object.hasOwn(created, key), false, `the response row must not carry ${key}`)

  const first = await photoOf(alice.jwt, created.id, `?v=${created.photo_version}`)
  assert.equal(first.status, 200, first.bytes.toString('utf8', 0, 200))
  const headerNames = ['content-type', 'cache-control', 'x-content-type-options', 'content-security-policy',
    'cross-origin-resource-policy', 'content-length']
  assert.deepEqual(Object.fromEntries(headerNames.map(name => [name, first.headers.get(name)])), {
    'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; sandbox", 'cross-origin-resource-policy': 'same-origin',
    'content-length': String(first.bytes.length) })
  const info = await sharp(first.bytes).metadata()
  assert.deepEqual([info.format, info.width, info.height], ['jpeg', 768, 1024], 'orientation is applied, then dropped')
  assert.deepEqual([info.exif, info.icc, info.xmp, info.orientation], [undefined, undefined, undefined, undefined])
  assert.equal(first.bytes.includes(Buffer.from('secret-copyright')), false, 'embedded metadata must not be stored')
  assert.ok(first.bytes.length <= 262_144, `${first.bytes.length} bytes`)
  const rows = await stored(created.id)
  assert.deepEqual([rows.length, rows[0]?.user_id], [1, alice.userId])
  assert.ok(rows[0].image.equals(first.bytes), 'the route serves exactly the stored bytes')
  assert.equal((await photoOf(alice.jwt, created.id, `?v=${randomUUID()}`)).status, 200, 'the version query is only a cache key')

  const listText = await (await request('/api/v1/discs', alice.jwt)).text()
  const [listed] = JSON.parse(listText).discs
  assert.deepEqual([listed.id, listed.edition, listed.photo_version], [created.id, 'Origin / Midnight Prowl 2', created.photo_version])
  assert.deepEqual(['photo', 'image'].filter(key => Object.hasOwn(listed, key)), [])
  assert.doesNotMatch(listText, /\/9j\/|"Buffer"/, 'photo bytes must never travel with the inventory')
  assert.ok(listText.length < 3000, `the inventory list is ${listText.length} characters`)

  const renamed = await call(alice.jwt, 'PATCH', `/api/v1/discs/${created.id}`, { edition: 'Origin / Midnight Prowl 3' })
  assert.deepEqual([renamed.edition, renamed.photo_version], ['Origin / Midnight Prowl 3', created.photo_version],
    'a write without a photo property keeps the stored photo')
  assert.ok((await photoOf(alice.jwt, created.id)).bytes.equals(first.bytes))

  const replaced = await call(alice.jwt, 'PATCH', `/api/v1/discs/${created.id}`, { photo: dataUrl(await makePhoto(640, 480)) })
  assert.match(replaced.photo_version, uuidPattern)
  assert.notEqual(replaced.photo_version, created.photo_version)
  assert.equal(replaced.edition, 'Origin / Midnight Prowl 3')
  const second = await photoOf(alice.jwt, created.id, `?v=${replaced.photo_version}`)
  const secondInfo = await sharp(second.bytes).metadata()
  assert.deepEqual([second.status, secondInfo.width, secondInfo.height], [200, 640, 480])
  assert.equal(second.bytes.equals(first.bytes), false, 'the new photo replaced the old bytes')
  assert.equal((await stored(created.id)).length, 1, 'a replaced photo does not leave the old row behind')

  const removed = await call(alice.jwt, 'PATCH', `/api/v1/discs/${created.id}`, { photo: null })
  assert.deepEqual([removed.photo_version, removed.edition, removed.name], [null, 'Origin / Midnight Prowl 3', 'Photo disc'])
  const gone = await photoOf(alice.jwt, created.id, `?v=${replaced.photo_version}`)
  assert.deepEqual([gone.status, gone.body], [404, { error: 'not_found' }])
  assert.equal((await stored(created.id)).length, 0)
  assert.equal((await call(alice.jwt, 'PATCH', `/api/v1/discs/${created.id}`, { photo: null })).photo_version, null,
    'removing a photo twice is harmless')

  const bare = await call(alice.jwt, 'POST', '/api/v1/discs', { name: 'Bare disc', photo: null }, 201)
  assert.deepEqual([bare.photo_version, bare.edition], [null, ''])
})

test('legacy photo links, editions and server-owned fields behave predictably', async t => {
  const { call, request, photoOf, snapshot, mintUser } = await startApi(t)
  const user = await mintUser()
  const link = 'https://photos.example.test/legacy.jpg'
  const photo = dataUrl(await makePhoto(800, 600))
  const linked = await call(user.jwt, 'POST', '/api/v1/discs', { name: 'Linked', user_photo_url: link }, 201)
  assert.deepEqual([linked.user_photo_url, linked.photo_version, linked.edition], [link, null, ''])
  assert.equal((await photoOf(user.jwt, linked.id)).status, 404, 'a legacy link is not a stored photo')
  assert.equal((await call(user.jwt, 'PATCH', `/api/v1/discs/${linked.id}`, { name: 'Linked again' })).user_photo_url, link)

  const uploaded = await call(user.jwt, 'PATCH', `/api/v1/discs/${linked.id}`,
    { photo, user_photo_url: 'https://elsewhere.example.test/x.jpg' })
  assert.equal(uploaded.user_photo_url, null, 'an uploaded photo supersedes the legacy link, even when the client echoes one')
  assert.match(uploaded.photo_version, uuidPattern)
  const echoed = await call(user.jwt, 'PATCH', `/api/v1/discs/${linked.id}`, { name: 'Echoed', edition: 'Echo', user_photo_url: null })
  assert.deepEqual([echoed.photo_version, echoed.user_photo_url], [uploaded.photo_version, null], 'an ordinary save keeps the stored photo')
  assert.equal((await photoOf(user.jwt, linked.id)).status, 200)
  const relinked = await call(user.jwt, 'PATCH', `/api/v1/discs/${linked.id}`, { user_photo_url: link })
  assert.deepEqual([relinked.user_photo_url, relinked.photo_version], [link, uploaded.photo_version],
    'a link-only write leaves the stored photo alone')
  const cleared = await call(user.jwt, 'PATCH', `/api/v1/discs/${linked.id}`, { photo: null })
  assert.deepEqual([cleared.user_photo_url, cleared.photo_version], [null, null], 'removing the photo also clears the legacy link')
  assert.equal((await photoOf(user.jwt, linked.id)).status, 404)

  const longest = '\u00e9'.repeat(200)
  const maxed = await call(user.jwt, 'POST', '/api/v1/discs', { name: 'Longest edition', edition: longest }, 201)
  assert.equal(maxed.edition, longest)
  await call(user.jwt, 'PATCH', `/api/v1/discs/${linked.id}`, { photo })
  const before = await snapshot(user, linked.id)
  assert.ok(before.image, 'the disc must hold a photo before the rejected writes')
  const rejected = {
    'edition of 201 characters': { edition: '\u00e9'.repeat(201) },
    'null edition': { edition: null },
    'numeric edition': { edition: 7 },
    'array edition': { edition: ['Origin'] },
    'client photo_version': { photo_version: randomUUID() },
    'null photo_version': { photo_version: null },
    'photo_version beside a photo': { photo, photo_version: randomUUID() },
    'photo_version beside a removal': { photo: null, photo_version: null },
    'raw image bytes': { image: 'AAAA' },
  }
  for (const [label, extra] of Object.entries(rejected)) {
    assert.deepEqual(await outcome(await request('/api/v1/discs', user.jwt, 'POST', { name: 'must-not-persist', ...extra })),
      [400, 'invalid_input'], `POST ${label}`)
    assert.deepEqual(await outcome(await request(`/api/v1/discs/${linked.id}`, user.jwt, 'PATCH', extra)),
      [400, 'invalid_input'], `PATCH ${label}`)
  }
  assert.deepEqual(await snapshot(user, linked.id), before, 'rejected writes change nothing')
  const names = (await call(user.jwt, 'GET', '/api/v1/discs')).discs.map(row => row.name).sort()
  assert.deepEqual(names, ['Echoed', 'Longest edition'], 'no rejected write created a disc')
})

test('stored photos are private to their owner and unreachable without a valid token', async t => {
  const { admin, runtime, request, call, photoOf, snapshot, token, mintUser } = await startApi(t)
  const alice = await mintUser()
  const bob = await mintUser()
  const aliceDisc = await call(alice.jwt, 'POST', '/api/v1/discs', { name: 'Alice photo', photo: dataUrl(await makePhoto(640, 480)) }, 201)
  const bareDisc = await call(alice.jwt, 'POST', '/api/v1/discs', { name: 'Alice bare' }, 201)
  const bobDisc = await call(bob.jwt, 'POST', '/api/v1/discs', { name: 'Bob photo', photo: dataUrl(await makePhoto(480, 640)) }, 201)
  const before = await snapshot(alice, aliceDisc.id)
  assert.ok(before.image)
  const path = `/api/v1/discs/${aliceDisc.id}/photo`
  const stranger = randomUUID()
  const unauthenticated = { 'no credentials': undefined, 'a malformed token': 'not-a-token',
    'the wrong audience': await token(stranger, 'wrong'), 'an expired token': await token(stranger, 'griplock-test', '-1s') }
  for (const [label, jwt] of Object.entries(unauthenticated)) {
    for (const query of ['', `?v=${aliceDisc.photo_version}`]) {
      assert.deepEqual(await outcome(await request(path + query, jwt)), [401, 'unauthorized'], `${label}${query}`)
    }
  }
  assert.deepEqual(await outcome(await request(path, await token(stranger, 'griplock-test', '5m', 'other_scope'))),
    [403, 'insufficient_scope'])

  const missing = [404, { error: 'not_found' }]
  for (const query of ['', `?v=${aliceDisc.photo_version}`, `?v=${bobDisc.photo_version}`]) {
    const read = await photoOf(bob.jwt, aliceDisc.id, query)
    assert.deepEqual([read.status, read.body], missing, `bob reads alice's photo${query}`)
  }
  const crossRead = await photoOf(alice.jwt, bobDisc.id)
  assert.deepEqual([crossRead.status, crossRead.body], missing, "alice reads bob's photo")
  const forged = dataUrl(await makePhoto(320, 240))
  for (const body of [{ photo: forged }, { photo: null }, { name: 'stolen', edition: 'stolen' }]) {
    assert.deepEqual(await outcome(await request(`/api/v1/discs/${aliceDisc.id}`, bob.jwt, 'PATCH', body)), [404, 'not_found'],
      `bob patches ${Object.keys(body)}`)
  }
  assert.deepEqual(await outcome(await request(`/api/v1/discs/${aliceDisc.id}`, bob.jwt, 'DELETE')), [404, 'not_found'])
  assert.deepEqual(await snapshot(alice, aliceDisc.id), before, "bob's attempts must not change alice's disc or photo")
  assert.deepEqual((await call(bob.jwt, 'GET', '/api/v1/discs')).discs.map(row => row.id), [bobDisc.id])

  for (const [label, read] of [['an unknown disc', await photoOf(alice.jwt, randomUUID())], ['a disc without a photo', await photoOf(alice.jwt, bareDisc.id)]]) {
    assert.deepEqual([read.status, read.body], missing, label)
  }
  const malformed = await photoOf(alice.jwt, 'not-a-uuid')
  assert.deepEqual([malformed.status, malformed.body], [400, { error: 'invalid_id' }])
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.deepEqual(await outcome(await request(path, alice.jwt, method, method === 'DELETE' ? undefined : {})),
      [405, 'method_not_allowed'], method)
  }
  assert.deepEqual(await snapshot(alice, aliceDisc.id), before, 'a rejected method must not touch the photo')

  const visible = async user => (await asUser(runtime, user.userId, client => client.query(
    'SELECT disc_id, user_id FROM disc_photos'))).rows
  assert.deepEqual(await visible(alice), [{ disc_id: aliceDisc.id, user_id: alice.userId }])
  assert.deepEqual(await visible(bob), [{ disc_id: bobDisc.id, user_id: bob.userId }])
  assert.equal((await runtime.query('SELECT disc_id FROM disc_photos')).rowCount, 0, 'no user context sees no photos')
  const insert = (user, discId, owner) => asUser(runtime, user.userId, client => client.query(
    'INSERT INTO disc_photos (disc_id, user_id, image) VALUES ($1, $2, $3)', [discId, owner, Buffer.from([0xff])]))
  await assert.rejects(insert(bob, bareDisc.id, alice.userId), /row-level security/, "bob cannot write a row owned by alice")
  await assert.rejects(insert(bob, bareDisc.id, bob.userId), { code: '23503' }, "bob cannot attach an image to alice's disc")
  const touched = await asUser(runtime, bob.userId, async client => [
    (await client.query('UPDATE disc_photos SET image = $1 WHERE disc_id = $2', [Buffer.from([0xff]), aliceDisc.id])).rowCount,
    (await client.query('DELETE FROM disc_photos WHERE disc_id = $1', [aliceDisc.id])).rowCount])
  assert.deepEqual(touched, [0, 0], "bob's SQL cannot even see alice's photo row")
  assert.deepEqual(await snapshot(alice, aliceDisc.id), before)
  const flags = await admin.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.disc_photos'::regclass")
  assert.deepEqual(flags.rows, [{ relrowsecurity: true, relforcerowsecurity: true }])
})

test('invalid, oversized and forged photo payloads are rejected without changing anything', async t => {
  const { request, call, snapshot, mintUser } = await startApi(t)
  const user = await mintUser()
  const small = await makePhoto(640, 480)
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#aa3366' } }).png().toBuffer()
  const existing = await call(user.jwt, 'POST', '/api/v1/discs', { name: 'Existing', edition: 'Keep', photo: dataUrl(small) }, 201)
  const before = await snapshot(user, existing.id)
  assert.ok(before.image, 'a stored photo must exist for the rejected replacements to protect')
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')
  const rejected = [
    ['plain text', 'not an image', 400, 'invalid_photo'],
    ['png data url', `data:image/png;base64,${png.toString('base64')}`, 400, 'invalid_photo'],
    ['png bytes under the jpeg prefix', dataUrl(png), 400, 'invalid_photo'],
    ['svg under the jpeg prefix', dataUrl(svg), 400, 'invalid_photo'],
    ['random bytes', dataUrl(randomBytes(2000)), 400, 'invalid_photo'],
    ['truncated jpeg', dataUrl(small.subarray(0, small.length / 2)), 400, 'invalid_photo'],
    ['characters outside base64', 'data:image/jpeg;base64,@@@@', 400, 'invalid_photo'],
    ['empty payload', 'data:image/jpeg;base64,', 400, 'invalid_photo'],
    ['empty string', '', 400, 'invalid_photo'],
    ['a number', 42, 400, 'invalid_input'],
    ['an object', { data: 'x' }, 400, 'invalid_input'],
    ['an array', [], 400, 'invalid_input'],
    ['jpeg one byte over 512 KiB', dataUrl(pad(small, 524_289)), 413, 'photo_too_large'],
    ['4001 x 4000 pixels', dataUrl(await flatJpeg(4001, 4000)), 413, 'photo_too_large'],
    ['request body over 720 KiB', 'A'.repeat(800_000), 413, 'body_too_large'],
  ]
  for (const [label, photo, status, code] of rejected) {
    const body = { name: 'must-not-persist', edition: 'must-not-persist', photo }
    assert.deepEqual(await outcome(await request('/api/v1/discs', user.jwt, 'POST', body)), [status, code], `POST ${label}`)
    assert.deepEqual(await outcome(await request(`/api/v1/discs/${existing.id}`, user.jwt, 'PATCH', body)), [status, code], `PATCH ${label}`)
  }
  const notes = 'n'.repeat(20_000)
  const oversized = [
    ['a disc without a photo', '/api/v1/discs', 'POST', { name: 'must-not-persist', notes }],
    ['a disc with a null photo', '/api/v1/discs', 'POST', { name: 'must-not-persist', notes, photo: null }],
    ['a disc update', `/api/v1/discs/${existing.id}`, 'PATCH', { notes }],
    ['a bag carrying a photo string', '/api/v1/bags', 'POST', { name: 'must-not-persist', photo: notes }],
    ['a collection', '/api/v1/collections', 'POST', { name: 'must-not-persist', description: notes }],
  ]
  for (const [label, path, method, body] of oversized) {
    assert.deepEqual(await outcome(await request(path, user.jwt, method, body)), [413, 'body_too_large'], `${label} above 16 KiB`)
  }
  assert.deepEqual(await snapshot(user, existing.id), before, 'rejected writes change nothing')
  assert.deepEqual((await call(user.jwt, 'GET', '/api/v1/discs')).discs.map(row => row.name), ['Existing'], 'no rejected write created a disc')
  assert.deepEqual((await call(user.jwt, 'GET', '/api/v1/bags')).bags, [])
  assert.deepEqual((await call(user.jwt, 'GET', '/api/v1/collections')).collections, [])

  const largest = JSON.stringify({ name: 'N'.repeat(200), manufacturer: 'M'.repeat(200), disc_type: 'T'.repeat(200),
    plastic: 'P'.repeat(200), color: 'C'.repeat(200), condition: 'D'.repeat(200), notes: 'n'.repeat(5000),
    tags: Array.from({ length: 50 }, () => 't'.repeat(100)), edition: 'E'.repeat(200), quantity: 10_000,
    user_photo_url: `https://photos.example.test/${'u'.repeat(2000)}`, photo: dataUrl(pad(small, 524_288)) })
  const size = Buffer.byteLength(largest)
  assert.ok(size > 700_000 && size < 737_280, `the largest legitimate body is ${size} bytes`)
  const response = await request('/api/v1/discs', user.jwt, 'POST', largest)
  const accepted = await response.json()
  assert.equal(response.status, 201, JSON.stringify(accepted).slice(0, 300))
  assert.deepEqual([accepted.edition, accepted.user_photo_url], ['E'.repeat(200), null])
  assert.match(accepted.photo_version, uuidPattern)
})

test('a failing photo write rolls back the disc metadata in the same transaction', async t => {
  const { admin, request, call, snapshot, mintUser } = await startApi(t)
  const user = await mintUser()
  assert.match(user.userId, uuidPattern)
  const photo = dataUrl(await makePhoto(800, 600))
  const withPhoto = await call(user.jwt, 'POST', '/api/v1/discs',
    { name: 'Before', edition: 'Before', photo: dataUrl(await makePhoto(640, 480)) }, 201)
  const linked = await call(user.jwt, 'POST', '/api/v1/discs',
    { name: 'Linked', user_photo_url: 'https://photos.example.test/linked.jpg' }, 201)
  const state = async () => ({ withPhoto: await snapshot(user, withPhoto.id), linked: await snapshot(user, linked.id) })
  const before = await state()
  const failure = `griplock_test_photo_failure_${randomBytes(6).toString('hex')}`
  await admin.query(`CREATE FUNCTION ${failure}() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'synthetic photo failure'; END $$`)
  try {
    await admin.query(`CREATE TRIGGER ${failure}_write BEFORE INSERT OR UPDATE ON disc_photos FOR EACH ROW
      WHEN (NEW.user_id = '${user.userId}'::uuid) EXECUTE FUNCTION ${failure}()`)
    await admin.query(`CREATE TRIGGER ${failure}_delete BEFORE DELETE ON disc_photos FOR EACH ROW
      WHEN (OLD.user_id = '${user.userId}'::uuid) EXECUTE FUNCTION ${failure}()`)
    const attempts = [
      ['replacing a stored photo', withPhoto.id, { name: 'must-roll-back', edition: 'must-roll-back', photo }],
      ['adding a photo to a legacy link', linked.id, { name: 'must-roll-back', photo }],
      ['removing a stored photo', withPhoto.id, { name: 'must-roll-back', edition: 'must-roll-back', photo: null }],
    ]
    for (const [label, id, body] of attempts) {
      assert.deepEqual(await outcome(await request(`/api/v1/discs/${id}`, user.jwt, 'PATCH', body)),
        [503, 'service_unavailable'], label)
      assert.deepEqual(await state(), before, `${label} must leave every disc exactly as it was`)
    }
    assert.deepEqual(await outcome(await request('/api/v1/discs', user.jwt, 'POST', { name: 'must-roll-back', photo })),
      [503, 'service_unavailable'], 'creating a disc with a failing photo')
    assert.deepEqual((await call(user.jwt, 'GET', '/api/v1/discs')).discs.map(row => row.name).sort(), ['Before', 'Linked'])
  } finally {
    await admin.query(`DROP FUNCTION IF EXISTS ${failure}() CASCADE`)
  }
  const recovered = await call(user.jwt, 'PATCH', `/api/v1/discs/${withPhoto.id}`, { name: 'After', photo })
  assert.equal(recovered.name, 'After')
  assert.notEqual((await snapshot(user, withPhoto.id)).image, before.withPhoto.image, 'once the fault is gone the same write succeeds')
})

test('deleting a disc removes its photo, and the photo table enforces its own bounds', async t => {
  const { runtime, call, photoOf, mintUser } = await startApi(t)
  const user = await mintUser()
  const withPhoto = async name => call(user.jwt, 'POST', '/api/v1/discs', { name, photo: dataUrl(await makePhoto(640, 480)) }, 201)
  const viaApi = await withPhoto('Deleted through the API')
  const viaSql = await withPhoto('Deleted behind the API')
  const kept = await withPhoto('Kept')
  const bare = await call(user.jwt, 'POST', '/api/v1/discs', { name: 'No photo' }, 201)
  const inUserContext = (sql, params) => asUser(runtime, user.userId, client => client.query(sql, params))
  const stored = async () => (await inUserContext('SELECT disc_id FROM disc_photos')).rows.map(row => row.disc_id).sort()
  assert.deepEqual(await stored(), [viaApi.id, viaSql.id, kept.id].sort())

  assert.deepEqual(await call(user.jwt, 'DELETE', `/api/v1/discs/${viaApi.id}`), { deleted: true })
  assert.deepEqual(await stored(), [viaSql.id, kept.id].sort(), 'deleting through the API removes the photo with the disc')
  assert.equal((await photoOf(user.jwt, viaApi.id)).status, 404)
  await inUserContext('DELETE FROM owned_discs WHERE id = $1', [viaSql.id])
  assert.deepEqual(await stored(), [kept.id], 'deleting the disc directly in SQL cascades to its photo too')
  assert.equal((await photoOf(user.jwt, viaSql.id)).status, 404)
  assert.equal((await photoOf(user.jwt, kept.id)).status, 200, "another disc's photo is untouched")

  const attach = (discId, image) => inUserContext(
    'INSERT INTO disc_photos (disc_id, user_id, image) VALUES ($1, $2, $3)', [discId, user.userId, image])
  await assert.rejects(attach(randomUUID(), Buffer.from([1])), { code: '23503' }, 'a photo needs an existing disc')
  await assert.rejects(attach(bare.id, Buffer.alloc(0)), { code: '23514' }, 'an empty image')
  await assert.rejects(attach(bare.id, Buffer.alloc(262_145)), { code: '23514' }, 'an image above 256 KiB')
  await attach(bare.id, Buffer.alloc(262_144))
  await assert.rejects(attach(bare.id, Buffer.from([1])), { code: '23505' }, 'a disc holds at most one photo')
  assert.deepEqual(await stored(), [bare.id, kept.id].sort(), 'only the largest allowed image was stored')
})

test('a schema-2 database upgrades to the current schema and keeps its discs', async t => {
  const password = process.env.PGAPP_PASSWORD
  const admin = createPool()
  const scratch = `griplock_upgrade_${randomBytes(6).toString('hex')}`
  const pools = []
  // pool.end() resolves before the server has closed its backends, so DROP DATABASE ... WITH (FORCE)
  // can still terminate one. Without a listener that late "terminating connection" notice
  // surfaces as an uncaught exception in whichever test is running.
  const scratchPool = options => {
    const pool = createPool(options)
    pool.on('error', () => {})
    pools.push(pool)
    return pool
  }
  t.after(async () => {
    const failures = []
    for (const pool of pools.toReversed()) {
      try { await pool.end() } catch (error) { failures.push(error) }
    }
    try { await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`) } catch (error) { failures.push(error) }
    try { await admin.end() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'upgrade test cleanup failed')
  })
  try {
    await admin.query(`CREATE DATABASE ${scratch}`)
  } catch (error) {
    if (error.code !== '42501') throw error
    t.skip('the database role may not create the scratch database this upgrade test needs')
    return
  }
  const legacy = scratchPool({ ...process.env, PGDATABASE: scratch })
  await legacy.query(`CREATE TABLE schema_migrations (
    version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
  for (const [index, file] of ['001_initial.sql', '002_features.sql'].entries()) {
    const sql = await readFile(new URL(`../../server/migrations/${file}`, import.meta.url), 'utf8')
    await legacy.query(sql)
    await legacy.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
      [index + 1, createHash('sha256').update(sql).digest('hex')])
  }
  const userId = randomUUID()
  const discId = randomUUID()
  const link = 'https://photos.example.test/legacy.jpg'
  await legacy.query("INSERT INTO app_users (id, issuer, subject) VALUES ($1, 'https://issuer.example.test', $2)", [userId, randomUUID()])
  await asUser(legacy, userId, client => client.query(`INSERT INTO owned_discs (id, user_id, name, manufacturer, disc_type, user_photo_url)
    VALUES ($1, $2, 'Legacy Buzzz', 'Discraft', 'Utility', $3)`, [discId, userId, link]))
  const newObjects = async () => (await legacy.query(`SELECT column_name AS name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'owned_discs' AND column_name IN ('edition', 'photo_version')
    UNION ALL SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'disc_photos'`)).rows
  assert.deepEqual(await newObjects(), [], 'the fixture must really be a schema-2 database')

  await migrate(legacy, password)
  const versions = (await legacy.query('SELECT version FROM schema_migrations ORDER BY version')).rows.map(row => row.version)
  assert.deepEqual(versions, Array.from({ length: schemaVersion }, (_, index) => index + 1))
  assert.equal((await newObjects()).length, 3, 'the upgrade adds edition, photo_version and disc_photos')
  const upgraded = await asUser(legacy, userId, client => client.query(
    'SELECT id, name, manufacturer, disc_type, user_photo_url, edition, photo_version FROM owned_discs'))
  assert.deepEqual(upgraded.rows, [{ id: discId, name: 'Legacy Buzzz', manufacturer: 'Discraft', disc_type: 'Utility',
    user_photo_url: link, edition: '', photo_version: null }], 'existing discs keep their data and get empty new fields')
  const flags = await legacy.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public.disc_photos'::regclass")
  assert.deepEqual(flags.rows, [{ relrowsecurity: true, relforcerowsecurity: true }])

  const runtime = scratchPool({ ...process.env, PGDATABASE: scratch, PGUSER: 'griplock_app', PGPASSWORD: password })
  const image = Buffer.from('upgraded photo')
  await asUser(runtime, userId, client => client.query(
    'INSERT INTO disc_photos (disc_id, user_id, image) VALUES ($1, $2, $3)', [discId, userId, image]))
  const visibleTo = id => asUser(runtime, id, client => client.query('SELECT disc_id, image FROM disc_photos'))
  assert.deepEqual((await visibleTo(userId)).rows, [{ disc_id: discId, image }], 'the runtime role can use the upgraded table')
  assert.equal((await visibleTo(randomUUID())).rowCount, 0, 'and only its owner sees the row')

  await migrate(legacy, password)
  assert.equal((await legacy.query('SELECT count(*)::int AS count FROM schema_migrations')).rows[0].count, schemaVersion,
    'running the migration again changes nothing')
})

test('an authenticated upload that exceeds the cap and then stalls is answered at once and disconnected', async t => {
  const { port, call, mintUser } = await startApi(t)
  const user = await mintUser()
  // Writes the given chunks and then deliberately never ends the request body.
  const stalledUpload = (path, chunks) => {
    const agent = new Agent({ keepAlive: true })
    const outgoing = httpRequest({ agent, host: '127.0.0.1', port, path, method: 'POST', headers: {
      'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked', Authorization: authorization(user.jwt) } })
    let socketError = 'none'
    outgoing.on('error', error => { socketError = error.code ?? error.message })
    const answered = new Promise(resolve => outgoing.on('response', response => {
      const parts = []
      const closed = new Promise(done => response.socket.once('close', done))
      response.on('data', part => parts.push(part))
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(parts)), closed }))
    }))
    for (const chunk of chunks) outgoing.write(chunk)
    return {
      answered: within(patienceMs, answered, () => `no answer while the upload was still open (socket error: ${socketError})`),
      close: () => { outgoing.destroy(); agent.destroy() },
    }
  }
  const cases = [
    ['a disc write above 720 KiB', '/api/v1/discs', [Buffer.from('{"name":"Stalled","photo":"data:image/jpeg;base64,'),
      ...Array.from({ length: 8 }, () => Buffer.alloc(100_000, 0x41))]],
    ['a bag write above 16 KiB', '/api/v1/bags', [Buffer.from('{"name":"'), Buffer.alloc(20_000, 0x78)]],
    ['a bag write carrying a photo string above 16 KiB', '/api/v1/bags', [Buffer.from('{"photo":"'), Buffer.alloc(20_000, 0x78)]],
  ]
  for (const [label, path, chunks] of cases) {
    const upload = stalledUpload(path, chunks)
    try {
      const response = await upload.answered
      assert.deepEqual([response.status, response.body], [413, { error: 'body_too_large' }], label)
      await within(patienceMs, response.closed, `${label}: the server kept the unfinished upload connected`)
    } finally {
      upload.close()
    }
  }
  assert.deepEqual((await call(user.jwt, 'GET', '/api/v1/discs')).discs, [], 'a rejected upload must not create a disc')
  assert.deepEqual((await call(user.jwt, 'GET', '/api/v1/bags')).bags, [], 'a rejected upload must not create a bag')
})
