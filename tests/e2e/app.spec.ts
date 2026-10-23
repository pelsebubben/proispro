import { expect, test, type Page } from '@playwright/test'

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'player@example.test',
  app_metadata: { provider: 'google', providers: ['google'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}

async function isolateNetwork(page: Page, signedIn = false) {
  const unexpected: string[] = []
  const session = {
    access_token: 'synthetic-test-token',
    refresh_token: 'synthetic-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  }
  if (signedIn) {
    await page.addInitScript(value => {
      localStorage.setItem('sb-odqhusmmqgipvazusrxs-auth-token', JSON.stringify(value))
    }, session)
  }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin === 'http://127.0.0.1:4173') return route.continue()
    if (url.hostname === 'odqhusmmqgipvazusrxs.supabase.co') {
      if (signedIn && url.pathname === '/auth/v1/user') {
        return route.fulfill({ json: user })
      }
      if (signedIn && route.request().method() === 'GET' && url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').at(-1)
        if (table === 'discs') {
          return route.fulfill({ json: [
            { id: 'disc-1', name: 'Fixture Buzzz', manufacturer: 'Discraft', disc_type: 'midrange',
              weight: 175, speed: 5, glide: 4, turn: -1, fade: 1, quantity: 1,
              added_at: '2026-01-01T00:00:00Z' },
            { id: 'disc-2', name: 'Fixture Destroyer', manufacturer: 'Innova', disc_type: 'distance',
              weight: 172, speed: 12, glide: 5, turn: -1, fade: 3, quantity: 1,
              added_at: '2026-01-02T00:00:00Z' },
          ] })
        }
        if (table === 'bags') return route.fulfill({ json: [] })
      }
    }
    unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`)
    await route.abort('blockedbyclient')
  })
  return unexpected
}

test('signed-out player sees both login options without external requests', async ({ page }) => {
  const unexpected = await isolateNetwork(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ProIsPro' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Sign in with Google/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Sign in with GitHub/ })).toBeVisible()
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true)
  expect(unexpected).toEqual([])
})

test('player can load, filter and clear a collection search', async ({ page }) => {
  const unexpected = await isolateNetwork(page, true)
  await page.goto('/')
  await expect(page.getByText('Fixture Buzzz', { exact: true })).toBeVisible()
  await expect(page.getByText('Fixture Destroyer', { exact: true })).toBeVisible()
  const search = page.getByPlaceholder('Search discs...', { exact: false })
  await search.fill('buzzz')
  await expect(page.getByText('Fixture Buzzz', { exact: true })).toBeVisible()
  await expect(page.getByText('Fixture Destroyer', { exact: true })).toHaveCount(0)
  await search.fill('')
  await expect(page.getByText('Fixture Destroyer', { exact: true })).toBeVisible()
  expect(unexpected).toEqual([])
})
