import { expect, test } from '@playwright/test'

test('curated courses remain browsable when database and provider are unavailable', async ({ page }) => {
  const courseRequests: string[] = []
  await page.addInitScript(() => sessionStorage.setItem('griplock.devAccessToken',
    `h.${btoa(JSON.stringify({ preferred_username: 'fixture' }))}.s`))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4173') {
      courseRequests.push(url.href)
      return route.abort()
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript',
      body: 'window.__GRIPLOCK_RUNTIME__={environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}' })
    if (url.pathname.startsWith('/api/v1/courses')) courseRequests.push(url.pathname)
    if (url.pathname.startsWith('/api/v1/')) return route.fulfill({ status: 503, json: { error: 'database_unavailable' } })
    return route.continue()
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Could not verify your application session')
  await page.getByRole('button', { name: 'Browse curated courses' }).click()
  const catalog = page.getByRole('region', { name: 'Browse curated courses' })
  await expect(catalog.getByText('Holmenkollen', { exact: true })).toBeVisible()
  await expect(catalog.getByText('Ekeberg', { exact: true })).toBeVisible()
  await expect(catalog.getByText('Karidalen', { exact: true })).toBeVisible()
  await catalog.getByText('Ekeberg', { exact: true }).click()
  await expect(catalog.getByRole('listitem').filter({ hasText: 'Ekeberg' })
    .getByText('Course details are not available yet.')).toBeVisible()
  await expect(catalog.getByRole('link', { name: 'View source' })).toHaveAttribute('href', 'https://www.pdga.com/node/27416')
  await catalog.getByRole('searchbox', { name: 'Find a curated course' }).fill('kar')
  await expect(catalog.getByText('Karidalen', { exact: true })).toBeVisible()
  await expect(catalog.getByText('Ekeberg', { exact: true })).toHaveCount(0)
  await catalog.getByRole('searchbox', { name: 'Find a curated course' }).fill('not found')
  await expect(catalog.getByRole('status')).toHaveText('No curated courses match your search.')
  await expect(catalog.getByText('Bag links and private game plans still require the database.')).toBeVisible()
  expect(courseRequests).toEqual([])
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Back to sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Griplock' })).toBeVisible()
})
