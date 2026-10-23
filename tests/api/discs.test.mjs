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
    jwksUrl: `${issuer}/jwks`, sourceSha: 'integration' }).listen(0, '127.0.0.1')
  await once(app, 'listening')
  t.after(() => new Promise(resolve => app.close(resolve)))
  const base = `http://127.0.0.1:${app.address().port}`
  const token = (subject, audience = 'griplock-test', expiry = '5m') => new SignJWT({})
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
