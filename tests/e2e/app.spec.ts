import { expect, test, type Page } from '@playwright/test'

async function isolateNetwork(page: Page, signedIn = false) {
  const unexpected: string[] = []
  if (signedIn) {
    await page.addInitScript(() => {
      const claims = btoa(JSON.stringify({ preferred_username: 'fixture-player' }))
      sessionStorage.setItem('griplock.devAccessToken', `h.${claims}.s`)
    })
  }
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4173') {
      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`)
      return route.abort('blockedbyclient')
    }
    if (url.pathname === '/runtime-config.js') {
      return route.fulfill({ contentType: 'text/javascript', body: `window.__GRIPLOCK_RUNTIME__ = ${JSON.stringify({
        environment: 'local-dev', dataBackend: 'api', identityReady: true, devAuth: true,
      })}` })
    }
    if (url.pathname === '/api/v1/session') return route.fulfill({ json: { userId: '11111111-1111-4111-8111-111111111111' } })
    if (url.pathname.startsWith('/api/v1/')) {
      expect(route.request().headers().authorization).toMatch(/^Bearer /)
      const resource = url.pathname.split('/').at(-1)!
      return route.fulfill({ json: { [resource]: resource === 'discs' ? [
        { id: '11111111-1111-4111-8111-111111111112', name: 'Fixture Buzzz', manufacturer: 'Discraft', disc_type: 'midrange',
          weight: 175, speed: 5, glide: 4, turn: -1, fade: 1, quantity: 1, added_at: '2026-01-01T00:00:00Z' },
        { id: '11111111-1111-4111-8111-111111111113', name: 'Fixture Destroyer', manufacturer: 'Innova', disc_type: 'distance',
          weight: 172, speed: 12, glide: 5, turn: -1, fade: 3, quantity: 1, added_at: '2026-01-02T00:00:00Z' },
      ] : [] } })
    }
    return route.continue()
  })
  return unexpected
}

test('signed-out player sees local login without external requests', async ({ page }) => {
  const unexpected = await isolateNetwork(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ProIsPro' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in locally' })).toBeVisible()
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= window.innerWidth)).toBe(true)
  expect(unexpected).toEqual([])
})

test('player can load, filter and clear an API-backed inventory search', async ({ page }) => {
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
  for (const name of [/Bags/, /Courses/, /Collections/, /Wishlist/, /For Sale/, /Analytics/]) {
    await page.getByRole('navigation').getByRole('button', { name }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)
  }
  expect(unexpected).toEqual([])
})

test('failed API loads are visible instead of looking like an empty collection', async ({ page }) => {
  await isolateNetwork(page, true)
  await page.route('**/api/v1/bags?*', route => route.fulfill({ status: 503, json: { error: 'service_unavailable' } }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('503')
})

test('new inventory and bags reach other tabs without reload and picker membership stays current', async ({ page }) => {
  const unexpected = await isolateNetwork(page, true)
  const discs: Record<string, unknown>[] = []
  const bags: { id: string; name: string; disc_ids: string[] }[] = []
  await page.route('https://discit-api.fly.dev/disc', route => route.fulfill({ json: [] }))
  await page.route('**/api/v1/discs**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { discs } })
    const disc = { ...route.request().postDataJSON(), added_at: new Date().toISOString() }
    discs.push(disc)
    return route.fulfill({ status: 201, json: disc })
  })
  await page.route('**/api/v1/bags**', async route => {
    const request = route.request()
    if (request.method() === 'GET') return route.fulfill({ json: { bags } })
    if (request.method() === 'POST') {
      const bag = request.postDataJSON()
      bags.push(bag)
      return route.fulfill({ status: 201, json: bag })
    }
    const bag = bags.find(b => b.id === new URL(request.url()).pathname.split('/').at(-1))!
    Object.assign(bag, request.postDataJSON())
    return route.fulfill({ json: bag })
  })
  await page.route('**/api/v1/collections?*', route => route.fulfill({ json: {
    collections: [{ id: '11111111-1111-4111-8111-111111111114', name: 'Favorites', description: '' }],
  } }))
  await page.goto('/')
  await page.getByRole('button', { name: '+ Add Disc', exact: true }).click()
  await page.locator('input[role="combobox"]').fill('Fresh disc')
  await page.locator('select').filter({ has: page.locator('option[value="midrange"]') }).selectOption('midrange')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Fresh disc', { exact: true })).toBeVisible()
  const nav = page.getByRole('navigation')
  await nav.getByRole('button', { name: /Bags/ }).click()
  page.once('dialog', dialog => dialog.accept('Fresh bag'))
  await page.getByRole('button', { name: '+ Create Bag' }).click()
  await expect(page.getByText('Fresh bag', { exact: true })).toBeVisible()
  await page.getByText('Fresh bag', { exact: true }).click()
  await page.getByRole('button', { name: 'Add / Remove Discs', exact: true }).click()
  const membership = page.getByRole('checkbox', { name: /Fresh disc/ })
  await membership.click()
  await expect(membership).toBeChecked()
  await membership.click()
  await expect(membership).not.toBeChecked()
  await page.keyboard.press('Escape')
  await nav.getByRole('button', { name: /Collections/ }).click()
  await page.getByRole('button', { name: '+ Add / Remove', exact: true }).click()
  await expect(page.getByText('Fresh disc', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await nav.getByRole('button', { name: /Courses/ }).click()
  await page.getByRole('button', { name: '+ Pin Course', exact: true }).click()
  await expect(page.locator('select option', { hasText: 'Fresh bag' })).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(unexpected).toEqual([])
})
