import { expect, test } from '@playwright/test'

const base = 'http://127.0.0.1:4173'

test('local dev identity signs in a named test user through the API session, without Supabase', async ({ page }) => {
  const unexpected: string[] = []
  const tokenRequests: unknown[] = []
  const sessionAuth: (string | undefined)[] = []
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== base) {
      unexpected.push(`${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    }
    if (url.pathname === '/runtime-config.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `window.__GRIPLOCK_RUNTIME__ = ${JSON.stringify({
        environment: 'local-dev', dataBackend: 'api', identityReady: true, devAuth: true,
      })}` })
    }
    if (url.pathname === '/dev-auth/token') {
      const body = request.postDataJSON()
      tokenRequests.push(body)
      if (body.user !== 'bob') return route.fulfill({ status: 400, json: { error: 'invalid_user' } })
      const claims = Buffer.from(JSON.stringify({ preferred_username: 'bob@dev.griplock.local' })).toString('base64url')
      return route.fulfill({ json: { access_token: `h.${claims}.s`, token_type: 'Bearer', expires_in: 3600, user: 'bob' } })
    }
    if (url.pathname === '/api/v1/session') {
      sessionAuth.push(request.headers().authorization)
      return route.fulfill({ json: { userId: '44444444-4444-4444-8444-444444444444' } })
    }
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('Local development identity. Not available in deployed builds.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Google|GitHub/ })).toHaveCount(0)
  await page.getByLabel('Test user').fill('Bad User')
  await page.getByRole('button', { name: 'Sign in locally' }).click()
  await expect(page.getByRole('alert')).toContainText('lowercase')
  await page.getByLabel('Test user').fill('bob')
  await page.getByRole('button', { name: 'Sign in locally' }).click()
  await expect(page.getByRole('heading', { name: 'Signed in to Griplock' })).toBeVisible()
  await expect(page.getByText('bob@dev.griplock.local')).toBeVisible()
  expect(tokenRequests).toEqual([{ user: 'Bad User' }, { user: 'bob' }])
  expect(sessionAuth.at(-1)).toMatch(/^Bearer h\./)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Signed in to Griplock' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in locally' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0)
  expect(unexpected).toEqual([])
})

test('hosted dev login asks for the shared passcode', async ({ page }) => {
  const tokenRequests: unknown[] = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== base) return route.abort('blockedbyclient')
    if (url.pathname === '/runtime-config.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `window.__GRIPLOCK_RUNTIME__ = ${JSON.stringify({
        environment: 'dev', dataBackend: 'api', identityReady: true, devAuth: true, devPasscode: true,
      })}` })
    }
    if (url.pathname === '/dev-auth/token') {
      const body = route.request().postDataJSON()
      tokenRequests.push(body)
      if (body.passcode !== 'right') return route.fulfill({ status: 401, json: { error: 'invalid_passcode' } })
      const claims = Buffer.from(JSON.stringify({ preferred_username: 'carol@dev.griplock.local' })).toString('base64url')
      return route.fulfill({ json: { access_token: `h.${claims}.s`, token_type: 'Bearer', expires_in: 3600, user: 'carol' } })
    }
    if (url.pathname === '/api/v1/session') return route.fulfill({ json: { userId: '55555555-5555-4555-8555-555555555555' } })
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('Shared dev environment. Test data only, never production.')).toBeVisible()
  await page.getByLabel('Test user').fill('carol')
  await page.getByLabel('Dev passcode').fill('wrong')
  await page.getByRole('button', { name: 'Sign in to dev' }).click()
  await expect(page.getByRole('alert')).toContainText('Wrong dev passcode')
  await page.getByLabel('Dev passcode').fill('right')
  await page.getByRole('button', { name: 'Sign in to dev' }).click()
  await expect(page.getByText('carol@dev.griplock.local')).toBeVisible()
  expect(tokenRequests).toEqual([{ user: 'carol', passcode: 'wrong' }, { user: 'carol', passcode: 'right' }])
})