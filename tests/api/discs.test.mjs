import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import test from 'node:test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { createPool, asUser } from '../../server/database.mjs'
import { migrate } from '../../server/migrate.mjs'
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
