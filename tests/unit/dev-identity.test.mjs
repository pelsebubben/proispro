import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { exportJWK, generateKeyPair } from 'jose'
import { createApplication } from '../../server/app.mjs'
import { assertDevIdentityAllowed, createDevIdentity, DEV_ISSUER, hostedDevPasscode } from '../../server/dev-identity.mjs'

const local = { GRIPLOCK_DEV_AUTH: 'local-only', NODE_ENV: 'development' }

test('dev identity refuses every non-local configuration', () => {
  assert.doesNotThrow(() => assertDevIdentityAllowed(local, { host: '127.0.0.1', customerIdentity: null }))
  assert.doesNotThrow(() => assertDevIdentityAllowed(local, { host: '::1', customerIdentity: null }))
  const refused = [
    [{ ...local, GRIPLOCK_DEV_AUTH: 'true' }, '127.0.0.1', null],
    [{ ...local, GRIPLOCK_DEV_AUTH: '1' }, '127.0.0.1', null],
    [{ ...local, NODE_ENV: 'production' }, '127.0.0.1', null],
    [{ ...local, CONTAINER_APP_NAME: 'app-griplock-staging' }, '127.0.0.1', null],
    [{ ...local, CONTAINER_APP_ENV_DNS_SUFFIX: 'x.azurecontainerapps.io' }, '127.0.0.1', null],
    [{ ...local, KUBERNETES_SERVICE_HOST: '10.0.0.1' }, '127.0.0.1', null],
    [{ ...local, WEBSITE_SITE_NAME: 'griplock' }, '127.0.0.1', null],
    [local, '0.0.0.0', null],
    [local, '192.168.1.10', null],
    [local, '127.0.0.1', { issuer: 'https://t.ciamlogin.com/t/v2.0' }],
  ]
  for (const [env, host, customerIdentity] of refused) {
    assert.throws(() => assertDevIdentityAllowed(env, { host, customerIdentity }), undefined, JSON.stringify({ env, host }))
  }
})

test('shipped image and deployment cannot enable dev identity', async () => {
  const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
  assert.match(await read('Dockerfile'), /^ENV NODE_ENV=production\b/m)
  for (const path of ['infra/app.bicep', 'infra/staging.bicep', '.github/workflows/prod.yml', '.github/workflows/dev.yml', 'Dockerfile']) {
    assert.doesNotMatch(await read(path), /GRIPLOCK_DEV_AUTH|dev-server/, path)
  }
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try {
    const devIdentity = await createDevIdentity()
    assert.throws(() => createApplication({ pool: {}, devIdentity }), /forbidden in production/)
  } finally {
    process.env.NODE_ENV = previous
  }
})

async function serve(t, options) {
  const subjects = []
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('INSERT INTO app_users')) subjects.push(params)
    return { rows: [{ id: `user:${params?.[1]}` }] }
  } }
  const server = createApplication({ pool, ...options }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => server.close(resolve)))
  const base = `http://127.0.0.1:${server.address().port}`
  const post = body => fetch(`${base}/dev-auth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const session = token => fetch(`${base}/api/v1/session`, { headers: { Authorization: `Bearer ${token}` } })
  return { base, post, session, subjects }
}

test('dev tokens go through full verification and map to distinct dev users', async t => {
  const { base, post, session, subjects } = await serve(t, { devIdentity: await createDevIdentity() })
  assert.deepEqual(await (await fetch(`${base}/auth/config`)).json(),
    { environment: 'local-dev', dataBackend: 'api', identityReady: true, devAuth: true })
  const alice = await (await post({ user: 'alice' })).json()
  const bob = await (await post({ user: 'bob' })).json()
  assert.equal(alice.token_type, 'Bearer')
  assert.deepEqual(await (await session(alice.access_token)).json(), { userId: 'user:dev:alice' })
  assert.deepEqual(await (await session(bob.access_token)).json(), { userId: 'user:dev:bob' })
  assert.deepEqual(subjects, [[DEV_ISSUER, 'dev:alice'], [DEV_ISSUER, 'dev:bob']])
  const [header, payload, signature] = alice.access_token.split('.')
  const forged = JSON.parse(Buffer.from(payload, 'base64url'))
  forged.sub = 'dev:bob'
  const tampered = `${header}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${signature}`
  assert.equal((await session(tampered)).status, 401)
  const scopeless = await (await post({ user: 'alice', scope: '' })).json()
  assert.equal((await session(scopeless.access_token)).status, 403)
  for (const user of ['', 'Alice', '../x', 'a b', 'a'.repeat(65), 7]) {
    assert.equal((await post({ user })).status, 400, String(user))
  }
  assert.equal((await post({ user: 'alice', scope: 'a\nb' })).status, 400)
  assert.equal((await fetch(`${base}/dev-auth/token`)).status, 405)
})

test('servers without dev identity expose no token endpoint and reject dev tokens', async t => {
  const dev = await serve(t, { devIdentity: await createDevIdentity() })
  const devToken = (await (await dev.post({ user: 'alice' })).json()).access_token
  const { publicKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'customer', alg: 'RS256', use: 'sig' }
  const keys = createServer((_req, res) => res.end(JSON.stringify({ keys: [jwk] }))).listen(0, '127.0.0.1')
  await once(keys, 'listening')
  t.after(() => new Promise(resolve => keys.close(resolve)))
  const issuer = `http://127.0.0.1:${keys.address().port}`
  const customer = await serve(t, { issuer, audience: 'griplock-api', jwksUrl: `${issuer}/jwks`, requiredScope: 'access_as_user' })
  assert.equal((await customer.post({ user: 'alice' })).status, 404)
  assert.equal((await customer.session(devToken)).status, 401)
  assert.equal((await (await fetch(`${customer.base}/auth/config`)).json()).devAuth, undefined)
  const disabled = await serve(t, {})
  assert.equal((await disabled.post({ user: 'alice' })).status, 404)
  assert.equal((await disabled.session(devToken)).status, 503)
})

const passcode = 'p'.repeat(40)
const hosted = { GRIPLOCK_DEV_PASSCODE: passcode, GRIPLOCK_STAGE: 'dev', CONTAINER_APP_NAME: 'app-griplock-dev', NODE_ENV: 'production' }

test('hosted dev passcode login is only allowed on the dev app', () => {
  assert.equal(hostedDevPasscode({}), null)
  assert.equal(hostedDevPasscode({ GRIPLOCK_DEV_PASSCODE: '' }), null)
  assert.equal(hostedDevPasscode(hosted), passcode)
  const refused = [
    { ...hosted, CONTAINER_APP_NAME: 'app-griplock-staging' },
    { ...hosted, CONTAINER_APP_NAME: undefined },
    { ...hosted, GRIPLOCK_STAGE: 'live' },
    { ...hosted, GRIPLOCK_STAGE: undefined },
    { ...hosted, GRIPLOCK_DEV_PASSCODE: 'short' },
    { ...hosted, GRIPLOCK_DEV_AUTH: 'local-only' },
  ]
  for (const env of refused) assert.throws(() => hostedDevPasscode(env), undefined, JSON.stringify(env))
})

test('only the dev app deployment can receive the passcode', async () => {
  const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8')
  const bicep = await read('infra/app.bicep')
  assert.match(bicep, /^var devLogin = !live && !empty\(devLoginPasscode\)$/m)
  assert.equal(bicep.match(/GRIPLOCK_DEV_PASSCODE/g).length, 1)
  assert.match(bicep, /devLogin \? \[\n  \{ name: 'GRIPLOCK_STAGE', value: 'dev' \}\n  \{ name: 'GRIPLOCK_DEV_PASSCODE', secretRef: 'dev-passcode' \}\n\] : \[\]/)
  const prod = (await read('.github/workflows/prod.yml')).replace(/\r\n/g, '\n')
  const uses = prod.split('az deployment group create').filter(block => block.includes('devLoginPasscode'))
  assert.equal(uses.length, 1)
  assert.match(uses[0], /-n "dev-app-\$GITHUB_RUN_ID"[\s\S]*stage=dev/)
  for (const path of ['infra/staging.bicep', '.github/workflows/dev.yml', 'Dockerfile']) {
    assert.doesNotMatch(await read(path), /GRIPLOCK_DEV_PASSCODE|DEV_LOGIN|devLoginPasscode/, path)
  }
})

test('hosted dev login requires the passcode and throttles guessing', async t => {
  const previous = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  let app
  try {
    app = await serve(t, { devIdentity: await createDevIdentity({ passcode }) })
  } finally {
    process.env.NODE_ENV = previous
  }
  const { base, post, session } = app
  assert.deepEqual(await (await fetch(`${base}/auth/config`)).json(),
    { environment: 'dev', dataBackend: 'api', identityReady: true, devAuth: true, devPasscode: true })
  assert.equal((await post({ user: 'alice' })).status, 401)
  assert.equal((await post({ user: 'alice', passcode: `${passcode}x` })).status, 401)
  assert.equal((await post({ user: 'alice', passcode: 7 })).status, 401)
  const ok = await post({ user: 'alice', passcode })
  assert.equal(ok.status, 200)
  assert.deepEqual(await (await session((await ok.json()).access_token)).json(), { userId: 'user:dev:alice' })
  for (let i = 0; i < 17; i++) assert.equal((await post({ user: 'alice', passcode: 'wrong' })).status, 401)
  assert.equal((await post({ user: 'alice', passcode })).status, 429)
})