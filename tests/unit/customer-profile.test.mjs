import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transformWithOxc } from 'vite'

const source = await readFile(new URL('../../src/lib/customerProfile.ts', import.meta.url), 'utf8')
const { code: outputText } = await transformWithOxc(source, 'customerProfile.ts')
const { customerProfile } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const technical = '11111111-1111-4111-8111-111111111111@customers.onmicrosoft.com'
const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

test('Google email/name take priority over the generated Entra account username', () => {
  assert.deepEqual(customerProfile({
    username: technical, name: 'Sample Golfer',
    idTokenClaims: { email: 'golfer@example.test', name: 'Google Golfer' },
  }), { email: 'golfer@example.test', name: 'Google Golfer' })
  assert.deepEqual(customerProfile({
    username: technical, idTokenClaims: { emails: ['golfer@example.test'], name: 'Sample Golfer' },
  }), { email: 'golfer@example.test', name: 'Sample Golfer' })
})

test('missing claims do not turn an internal username or UPN into a user email', () => {
  for (const username of [technical, 'unverified@example.test']) {
    assert.deepEqual(customerProfile({ username }), { email: undefined, name: undefined })
  }
  assert.deepEqual(customerProfile({
    name: technical, idTokenClaims: { email: technical, emails: [technical.toUpperCase()] },
  }), { email: undefined, name: undefined })
  assert.deepEqual(customerProfile({ name: 'Sample Golfer' }), { email: undefined, name: 'Sample Golfer' })
})

test('malformed optional claims are skipped without losing a valid email', () => {
  for (const invalid of [null, 42, {}, ['not-a-string'], '', 'no-address', 'a b@example.test', 'a\n@example.test']) {
    assert.deepEqual(customerProfile({
      idTokenClaims: { email: invalid, emails: [invalid, ' golfer@example.test '] },
    }), { email: 'golfer@example.test', name: undefined })
  }
  assert.deepEqual(customerProfile({ idTokenClaims: { emails: 'not-an-array', name: '   ' } }),
    { email: undefined, name: undefined })
})

test('the actual Entra client keeps the API user ID when the display profile changes', async () => {
  const originalFetch = globalThis.fetch
  const originalWindow = globalThis.window
  globalThis.window = { location: { origin: 'https://app.example.test' } }
  const fixtureKey = '__griplockCustomerProfileTest'
  const fixture = {
    account: { username: technical, idTokenClaims: { email: 'first@example.test', name: 'First Name' } },
    userId: '22222222-2222-4222-8222-222222222222',
    status: 200,
    calls: [],
  }
  globalThis[fixtureKey] = fixture
  const sdk = moduleUrl(`
    export class InteractionRequiredAuthError extends Error {}
    export class PublicClientApplication {
      async initialize() {}
      async handleRedirectPromise() { return null }
      getAllAccounts() { return [globalThis.${fixtureKey}.account] }
      setActiveAccount() {}
      getActiveAccount() { return globalThis.${fixtureKey}.account }
      async acquireTokenSilent() { return {accessToken:'synthetic-test-access-token'} }
    }
  `)
  const runtime = moduleUrl(`export const runtime = {
    identityReady:true,entra:{clientId:'fixture',authority:'https://fixture.ciamlogin.com/tenant',scope:'api://fixture/access_as_user'}
  }`)
  const clientSource = await readFile(new URL('../../src/lib/entra.ts', import.meta.url), 'utf8')
  const compiled = (await transformWithOxc(clientSource, 'entra.ts')).code
    .replace(/["']@azure\/msal-browser["']/, JSON.stringify(sdk))
    .replace(/["']\.\/runtime["']/, JSON.stringify(runtime))
    .replace(/["']\.\/customerProfile["']/, JSON.stringify(moduleUrl(outputText)))
  globalThis.fetch = async (url, options) => {
    fixture.calls.push({ url, options })
    return new Response(JSON.stringify({ userId: fixture.userId }), { status: fixture.status })
  }
  try {
    const { entraUser } = await import(moduleUrl(compiled))
    assert.deepEqual(await entraUser(), { id: fixture.userId, email: 'first@example.test', name: 'First Name' })
    fixture.account.idTokenClaims = { email: 'updated@example.test', name: 'Updated Name' }
    assert.deepEqual(await entraUser(), { id: fixture.userId, email: 'updated@example.test', name: 'Updated Name' })
    fixture.userId = '33333333-3333-4333-8333-333333333333'
    assert.equal((await entraUser()).id, fixture.userId, 'same email cannot override a different API identity')
    fixture.status = 401
    assert.equal(await entraUser(), null, 'profile claims cannot sign in a rejected API identity')
    fixture.status = 503
    await assert.rejects(entraUser(), /Could not verify your application session \(503\)/)
    assert.ok(fixture.calls.every(call => call.url === '/api/v1/session' && !call.options.body),
      'profile fields are never sent to the API as identity assertions')
  } finally {
    globalThis.fetch = originalFetch
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    delete globalThis[fixtureKey]
  }
})

test('the actual header displays email, then name, then a neutral signed-in label', async () => {
  const require = createRequire(import.meta.url)
  const fixtureKey = '__griplockHeaderProfileTest'
  const layoutSource = await readFile(new URL('../../src/components/Layout.tsx', import.meta.url), 'utf8')
  const auth = moduleUrl(`export function useAuth() {
    return {user:globalThis.${fixtureKey},signOut:async()=>{}}
  }`)
  const compiled = (await transformWithOxc(layoutSource, 'Layout.tsx', { jsx: { runtime: 'automatic' } })).code
    .replace('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
    .replace(/["']\.\.\/contexts\/AuthContext["']/, JSON.stringify(auth))
  try {
    const { Layout } = await import(moduleUrl(compiled))
    for (const [profile, expected] of [
      [{ email: 'golfer@example.test', name: 'Google Golfer' }, 'golfer@example.test'],
      [{ name: 'Google Golfer' }, 'Google Golfer'],
      [{}, 'Signed in'],
    ]) {
      globalThis[fixtureKey] = { id: 'stable-api-user', ...profile }
      const html = renderToStaticMarkup(createElement(Layout, { activeTab: 'inventory', onTabChange() {} }))
      assert.ok(html.includes(expected), `header must display ${expected}`)
      assert.ok(!html.includes('stable-api-user'), 'internal identity is not a display fallback')
    }
  } finally {
    delete globalThis[fixtureKey]
  }
})
