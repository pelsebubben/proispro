import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createApplication } from '../../server/app.mjs'
import { schemaVersion } from '../../server/migrate.mjs'

test('runtime serves SPA and immutable assets without allowing unauthenticated API or production sign-in', async t => {
  const root = await mkdtemp(join(tmpdir(), 'griplock-runtime-'))
  t.after(() => rm(root, { recursive: true }))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'index.html'), '<h1>Griplock fixture</h1>')
  await writeFile(join(root, 'assets', 'app-123.js'), 'console.log("fixture")')
  let version = schemaVersion
  const pool = { query: async () => ({ rows: [{ version }] }) }
  const server = createApplication({ pool, staticRoot: root,
    sourceSha: 'unit-release' }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)
  const ready = await request('/health/ready')
  assert.deepEqual(await ready.json(), { status: 'ready', sourceSha: 'unit-release', schemaVersion })
  for (const incompatible of [1, 2, schemaVersion + 1]) {
    version = incompatible
    const unavailable = await request('/health/ready')
    assert.equal(unavailable.status, 503)
    assert.deepEqual(await unavailable.json(), { status: 'schema_not_ready' })
  }
  version = schemaVersion
  assert.equal((await request('/api/v1/discs')).status, 401)
  assert.equal((await request('/api/v1/courses?q=Norway')).status, 401)
  assert.equal((await request('/api/v1/courses/osm:way:123/holes')).status, 401)
  const disabled = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/discs`, {
    headers: { Authorization: 'Bearer synthetic-not-a-token' },
  })
  assert.equal(disabled.status, 503)
  assert.deepEqual(await disabled.json(), { error: 'identity_not_configured' })
  assert.deepEqual(await (await request('/auth/config')).json(), {
    environment: 'live', dataBackend: 'api', identityReady: false,
  })
  const config = await request('/runtime-config.js')
  assert.equal(await config.text(), 'window.__GRIPLOCK_RUNTIME__ = {"environment":"live","dataBackend":"api","identityReady":false}')
  assert.equal(config.headers.get('cache-control'), 'no-store')
  const deepLink = await request('/inventory')
  assert.equal(await deepLink.text(), '<h1>Griplock fixture</h1>')
  assert.equal(deepLink.headers.get('content-type'), 'text/html')
  const asset = await request('/assets/app-123.js')
  assert.equal(asset.headers.get('cache-control'), 'public,max-age=31536000,immutable')
  assert.equal((await request('/assets/missing.js')).status, 404)
  assert.equal((await request('/%2e%2e%2fpackage.json')).status, 404)
})
