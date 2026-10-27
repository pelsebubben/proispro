import { expect, test } from '@playwright/test'

test('mock preview opens the app with sample data and keeps navigation offline', async ({ page }) => {
  const backendRequests: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (/^\/(?:api|auth|dev-auth)(?:\/|$)/.test(url.pathname)) backendRequests.push(url.href)
  })

  await page.goto('/?mock=1')
  await expect(page.getByText('MOCK PREVIEW · NOT SAVED')).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('button', { name: /Inventory/ }))
    .toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('Aviar')).toBeVisible()

  await page.getByRole('navigation').getByRole('button', { name: /Bags/ }).click()
  await expect(page.getByRole('heading', { name: 'Everyday Bag' })).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: /Courses/ }).click()
  await expect(page).toHaveURL(/mock=1/)
  await expect(page.getByRole('heading', { name: 'Ekeberg Disc Golf Park' })).toBeVisible()
  await page.getByRole('button', { name: 'Open private planner' }).click()
  await expect(page.getByRole('heading', { name: 'Private layout & game plan' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hole 1' })).toBeVisible()

  await page.getByRole('navigation').getByRole('button', { name: /Wishlist/ }).click()
  await page.getByRole('button', { name: '+ Add to Wishlist' }).click()
  await page.getByPlaceholder('e.g., Firebird').fill('Roadrunner')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Roadrunner')).toBeVisible()

  expect(backendRequests).toEqual([])
})
