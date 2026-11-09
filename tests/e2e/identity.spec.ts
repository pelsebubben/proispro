import { expect, test } from '@playwright/test'

const authority = 'https://fixture.ciamlogin.com/11111111-1111-4111-8111-111111111111'
const clientId = '22222222-2222-4222-8222-222222222222'
const scope = 'api://33333333-3333-4333-8333-333333333333/access_as_user'
const base = 'http://127.0.0.1:4173'

test('External ID uses the Microsoft SDK authorization-code flow with PKCE', async ({ page }) => {
  const unexpected: string[] = []
  let authorization: URL | undefined
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === base) {
      if (url.pathname === '/runtime-config.js') {
        return route.fulfill({ contentType: 'text/javascript', body: `window.__GRIPLOCK_RUNTIME__ = ${JSON.stringify({
          environment: 'live', dataBackend: 'api', identityReady: true,
          entra: { authority, clientId, scope },
        })}` })
      }
      return route.continue()
    }
    if (url.href.startsWith(authority) && url.pathname.endsWith('/.well-known/openid-configuration')) {
      return route.fulfill({ json: {
        issuer: `${authority}/v2.0`, authorization_endpoint: `${authority}/oauth2/v2.0/authorize`,
        token_endpoint: `${authority}/oauth2/v2.0/token`, end_session_endpoint: `${authority}/oauth2/v2.0/logout`,
        jwks_uri: `${authority}/discovery/v2.0/keys`, response_types_supported: ['code'],
        subject_types_supported: ['pairwise'], id_token_signing_alg_values_supported: ['RS256'],
      } })
    }
    if (url.href.startsWith(`${authority}/oauth2/v2.0/authorize`)) {
      authorization = url
      return route.fulfill({ contentType: 'text/html', body: '<h1>Fixture identity provider</h1>' })
    }
    unexpected.push(`${url.origin}${url.pathname}`)
    return route.abort('blockedbyclient')
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Sign in to Griplock' })).toBeEnabled()
  await expect(page.getByRole('heading', { name: 'Your bag starts here' })).toBeVisible()
  await expect(page.locator('#login-help')).toContainText('Sign in with Google')
  await expect(page.locator('#login-help')).toContainText('No account? Create one')
  await expect(page.locator('#login-help')).toContainText('hosted by Microsoft Entra')
  await page.getByText('Can I use my Microsoft account?', { exact: true }).click()
  await expect(page.getByText(/Not as a Microsoft sign-in/)).toBeVisible()
  await page.getByText('Already signed in with Google?', { exact: true }).click()
  await expect(page.getByText(/separate account and bag/)).toBeVisible()
  await page.getByText('Missing name on the next screen?', { exact: true }).click()
  await expect(page.getByText(/Check the email below it/)).toBeVisible()
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Sign in to Griplock' }).focus()
  await expect(page.getByRole('button', { name: 'Sign in to Griplock' })).toBeFocused()
  await expect(page.getByRole('button', { name: /GitHub/ })).toHaveCount(0)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Fixture identity provider' })).toBeVisible()
  expect(authorization).toBeDefined()
  const params = authorization!.searchParams
  expect(params.get('client_id')).toBe(clientId)
  expect(params.get('response_type')).toBe('code')
  expect(params.get('code_challenge_method')).toBe('S256')
  expect(params.get('code_challenge')).toMatch(/^[\w-]{43}$/)
  expect(params.get('scope')?.split(' ')).toContain(scope)
  expect(params.get('scope')?.split(' ')).toEqual(expect.arrayContaining(['openid', 'profile', 'email']))
  expect(params.get('state')).toBeTruthy()
  expect(params.get('nonce')).toBeTruthy()
  expect(params.get('redirect_uri')).toBe(base)
  expect(params.has('client_secret')).toBe(false)
  expect(unexpected).toEqual([])
  await page.goto(`${base}/#${new URLSearchParams({
    error: 'access_denied', error_description: 'Fixture user cancelled sign-in',
    state: params.get('state')!,
  })}`)
  await expect(page.getByRole('alert')).toContainText('access_denied')
  await expect(page.getByRole('heading', { name: 'Signed in to Griplock' })).toHaveCount(0)
  const initialState = params.get('state')
  await page.getByRole('button', { name: 'Sign in to Griplock' }).click()
  await expect(page.getByRole('heading', { name: 'Fixture identity provider' })).toBeVisible()
  expect(authorization!.searchParams.get('state')).not.toBe(initialState)
  expect(unexpected).toEqual([])
})

test('live environment never trusts stale browser storage when identity is disabled', async ({ page }) => {
  const external: string[] = []
  await page.addInitScript(() => {
    localStorage.setItem('retired-auth-token', JSON.stringify({
      access_token: 'synthetic-stale-token', refresh_token: 'synthetic-stale-refresh',
      expires_at: 1, user: { id: 'synthetic-user' },
    }))
  })
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== base) {
      external.push(url.origin)
      return route.abort('blockedbyclient')
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({
      contentType: 'text/javascript',
      body: 'window.__GRIPLOCK_RUNTIME__ = {environment:"live",dataBackend:"api",identityReady:false}',
    })
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByRole('status')).toContainText('Customer sign-in is not configured')
  await expect(page.getByRole('button', { name: 'Sign in to Griplock' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Your bag starts here' })).toHaveCount(0)
  expect(external).toEqual([])
})
