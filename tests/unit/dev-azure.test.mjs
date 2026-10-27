import assert from 'node:assert/strict'
import test from 'node:test'
import { DEV_API, startAzureDev } from '../../scripts/dev-azure.mjs'

const config = { environment: 'dev', devAuth: true, devPasscode: true }
const ready = { status: 'ready' }

function fixture({ auth = config, health = ready, status = 200, redirect = false } = {}) {
  const requests = []
  let viteOptions
  let listening = false
  const server = {
    listen: async () => { listening = true },
    printUrls() {},
  }
  return {
    requests,
    get viteOptions() { return viteOptions },
    get listening() { return listening },
    dependencies: {
      fetchImpl: async (url, options) => {
        requests.push({ url, options })
        if (redirect) throw new TypeError('Redirect not allowed')
        return { ok: status === 200, status, json: async () => url.endsWith('/auth/config') ? auth : health }
      },
      createViteServer: async options => {
        viteOptions = options
        return server
      },
    },
  }
}

test('Azure UI launcher pins HTTPS dev, loopback and verified proxy targets without credentials', async () => {
  const f = fixture()
  await startAzureDev(f.dependencies)
  assert.equal(DEV_API, 'https://app-griplock-dev.delightfulisland-939e03e4.swedencentral.azurecontainerapps.io')
  assert.deepEqual(f.requests.map(({ url }) => url), [`${DEV_API}/auth/config`, `${DEV_API}/health/ready`])
  for (const { options } of f.requests) {
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal instanceof AbortSignal)
    assert.equal(options.headers, undefined)
  }
  assert.deepEqual(f.viteOptions.server, {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: Object.fromEntries(['/api', '/auth', '/dev-auth', '/runtime-config.js']
      .map(path => [path, { target: DEV_API, changeOrigin: true, secure: true }])),
  })
  assert.equal(f.listening, true)
})

test('Azure UI launcher refuses live, unprotected login, unhealthy API and redirects before starting Vite', async () => {
  for (const options of [
    { auth: { ...config, environment: 'live' } },
    { auth: { ...config, devAuth: false } },
    { auth: { ...config, devPasscode: false } },
    { auth: null },
    { health: { status: 'schema_not_ready' } },
    { status: 503 },
    { redirect: true },
  ]) {
    const f = fixture(options)
    await assert.rejects(startAzureDev(f.dependencies), /dev|ready|503|Redirect/)
    assert.equal(f.viteOptions, undefined)
    assert.equal(f.listening, false)
  }
})

test('Azure UI launcher refuses disabled TLS verification without making a request', async () => {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  try {
    const f = fixture()
    await assert.rejects(startAzureDev(f.dependencies), /TLS certificate verification/)
    assert.deepEqual(f.requests, [])
    assert.equal(f.viteOptions, undefined)
  } finally {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous
  }
})

test('Azure UI launcher cleans up Vite when the loopback port cannot be bound', async () => {
  const f = fixture()
  let closed = false
  await assert.rejects(startAzureDev({
    fetchImpl: f.dependencies.fetchImpl,
    createViteServer: async () => ({
      listen: async () => { throw new Error('Port 5173 is already in use') },
      close: async () => { closed = true },
      printUrls: () => assert.fail('Must not advertise a failed server'),
    }),
  }), /Port 5173 is already in use/)
  assert.equal(closed, true)
})
