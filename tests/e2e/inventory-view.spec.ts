import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

const PHOTO_VERSION = '22222222-2222-4222-8222-222222222222'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Server-shaped inventory: every type, one disc without a type, two with a stored personal photo.
const seed = [
  { id: id(1), name: 'Judge', manufacturer: 'Dynamic Discs', disc_type: 'putter', speed: 2, glide: 4, turn: 0, fade: 1, quantity: 2, photo_version: PHOTO_VERSION },
  { id: id(2), name: 'Aviar', manufacturer: 'Innova', disc_type: 'putter', speed: 2, glide: 3, turn: 0, fade: 1 },
  { id: id(3), name: 'Buzzz', manufacturer: 'Discraft', disc_type: 'midrange', speed: 5, glide: 4, turn: -1, fade: 1 },
  { id: id(4), name: 'Origin', edition: 'Midnight Prowl II', manufacturer: 'Discmania', disc_type: 'midrange', plastic: 'Meta',
    weight: 175, speed: 5, glide: 5, turn: -1, fade: 1, photo_version: PHOTO_VERSION },
  { id: id(5), name: 'Leopard3', manufacturer: 'Innova', disc_type: 'fairway', speed: 7, glide: 5, turn: -2, fade: 1 },
  { id: id(6), name: 'Destroyer', manufacturer: 'Innova', disc_type: 'distance', speed: 12, glide: 5, turn: -1, fade: 3, quantity: 3 },
  { id: id(7), name: 'Trail pointer', disc_type: 'utility' },
  { id: id(8), name: 'Mystery disc' },
].map((disc, index) => ({
  edition: '', quantity: 1, tags: [], condition: 'good', added_at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(), ...disc,
}))

async function seeded(page: Page) {
  const external: string[] = []
  // Landscape, like the photos saved before the crop step existed.
  const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: '#3989b8' } }).jpeg().toBuffer()
  await page.addInitScript(() => {
    const claims = btoa(JSON.stringify({ preferred_username: 'inventory-view-fixture' }))
    sessionStorage.setItem('griplock.devAccessToken', `h.${claims}.s`)
  })
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173') {
      external.push(url.origin)
      return route.abort()
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript',
      body: 'window.__GRIPLOCK_RUNTIME__ = {environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}' })
    if (url.pathname === '/api/v1/session') return route.fulfill({ json: { userId: '11111111-1111-4111-8111-111111111111' } })
    if (url.pathname.startsWith('/api/v1/')) {
      expect(request.headers().authorization).toMatch(/^Bearer /)
      if (url.pathname.endsWith('/photo')) return route.fulfill({ contentType: 'image/jpeg', body: photo })
      const resource = url.pathname.split('/').at(-1)!
      return route.fulfill({ json: { [resource]: resource === 'discs' ? seed : [] } })
    }
    return route.continue()
  })
  await page.goto('/')
  await expect(page.getByText('Judge', { exact: true })).toBeVisible()
  return { external }
}

const cardOf = (page: Page, name: string) =>
  page.locator('[style*="grid-template-columns"] > div').filter({ has: page.getByText(name, { exact: true }) })
const rowOf = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^(\\d+× )?${name}\\b`) })
const noHorizontalScroll = (page: Page) => page.locator('body').evaluate(body => body.scrollWidth <= innerWidth)

test('cards show the photo, or a stock illustration, small in the top-right corner', async ({ page }, info) => {
  const { external } = await seeded(page)
  for (const name of ['Judge', 'Aviar']) {
    const card = cardOf(page, name)
    const frame = (await card.boundingBox())!
    const thumb = (await card.locator('.disc-thumb').boundingBox())!
    expect(thumb.width).toBeLessThanOrEqual(80)
    expect(Math.abs(thumb.width - thumb.height)).toBeLessThan(1)
    const fromRight = frame.x + frame.width - (thumb.x + thumb.width)
    const fromTop = thumb.y - frame.y
    expect(fromRight).toBeGreaterThanOrEqual(0)
    expect(fromRight).toBeLessThanOrEqual(20)
    expect(fromTop).toBeGreaterThanOrEqual(0)
    expect(fromTop).toBeLessThanOrEqual(20)
  }
  const photo = cardOf(page, 'Judge').getByAltText('Judge personal photo')
  await expect(photo).toBeVisible()
  await expect(photo).toHaveCSS('object-fit', 'cover')
  const shown = (await photo.boundingBox())!
  expect(Math.abs(shown.width - shown.height)).toBeLessThan(1)
  await expect(cardOf(page, 'Aviar').getByAltText(/personal photo/)).toHaveCount(0)
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('cards.png'), scale: 'css', fullPage: true })
  expect(external).toEqual([])
})

test('the edit form shows the photo small in its top-right corner', async ({ page }, info) => {
  const { external } = await seeded(page)
  await cardOf(page, 'Judge').getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Edit Disc' })).toBeVisible()
  const photo = dialog.getByAltText('Judge personal photo')
  await expect(photo).toBeVisible()
  const frame = (await dialog.boundingBox())!
  const thumb = (await photo.boundingBox())!
  expect(thumb.width).toBeLessThanOrEqual(100)
  expect(Math.abs(thumb.width - thumb.height)).toBeLessThan(1)
  expect(frame.x + frame.width - (thumb.x + thumb.width)).toBeLessThanOrEqual(40)
  expect(thumb.y - frame.y).toBeLessThanOrEqual(40)
  await expect(dialog.getByRole('combobox', { name: /Disc Name/ })).toBeInViewport()
  await page.screenshot({ path: info.outputPath('edit-dialog.png'), scale: 'css' })
  expect(external).toEqual([])
})

test('the list groups discs from putter up to distance driver, with counts and A-Z inside each group', async ({ page }, info) => {
  const { external } = await seeded(page)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.getByRole('heading', { level: 3 })).toHaveText([
    'Putter (2)', 'Midrange (2)', 'Fairway Driver (1)', 'Distance Driver (1)', 'Utility (1)', 'No type (1)',
  ])
  const titles = (group: RegExp) => page.getByRole('region', { name: group }).locator('.disc-row-title')
  await expect(titles(/^Putter/)).toHaveText(['Aviar', 'Judge'])
  await expect(titles(/^Midrange/)).toHaveText(['Buzzz', 'Origin'])
  await expect(titles(/^Fairway/)).toHaveText(['Leopard3'])
  await expect(titles(/^Distance/)).toHaveText(['Destroyer'])
  await expect(titles(/^Utility/)).toHaveText(['Trail pointer'])
  await expect(titles(/^No type/)).toHaveText(['Mystery disc'])
  await expect(rowOf(page, 'Judge')).toContainText('2×')
  await expect(rowOf(page, 'Aviar')).toContainText('2 | 3 | 0 | 1')
  await expect(rowOf(page, 'Origin')).toContainText('Midnight Prowl II')
  await expect(rowOf(page, 'Origin')).toContainText('Discmania')
  await expect(rowOf(page, 'Origin')).toContainText('Personal photo')
  // The edition is what tells "Midnight Prowl I" from "II", so a row wraps it instead of clipping it.
  expect(await rowOf(page, 'Origin').locator('.disc-row-line').evaluate(line => line.scrollWidth <= line.clientWidth)).toBe(true)
  await expect(rowOf(page, 'Aviar')).not.toContainText('Personal photo')
  if (info.project.name.startsWith('mobile')) {
    for (const row of await page.locator('.disc-row-main').all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  expect(await noHorizontalScroll(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('list.png'), scale: 'css', fullPage: true })
  expect(external).toEqual([])
})

test('hovering or tapping a row previews that disc: your photo if you have one, a stock illustration if not', async ({ page }, info) => {
  const { external } = await seeded(page)
  const touch = info.project.name.startsWith('mobile')
  const point = (name: string) => touch ? rowOf(page, name).tap() : rowOf(page, name).hover()
  await page.getByRole('button', { name: 'List', exact: true }).click()
  const preview = page.getByRole('complementary', { name: 'Selected disc' })
  await expect(preview.getByRole('img', { name: 'Aviar stock illustration' })).toBeVisible()
  const stripHeight = async () => (await preview.boundingBox())!.height
  const initialHeight = await stripHeight()
  // The narrow layout shrinks the preview to a thumbnail strip: caption, maker and details only exist on wide screens.
  if (!touch) await expect(preview.getByText('Stock illustration', { exact: true })).toBeVisible()
  await point('Origin')
  await expect(preview.getByRole('img', { name: 'Origin personal photo' })).toBeVisible()
  await expect(preview.getByText('Midnight Prowl II')).toBeVisible()
  // The phone strip keeps its height, so the rows do not slide away from under the next tap.
  if (touch) expect(await stripHeight()).toBeCloseTo(initialHeight, 0)
  if (!touch) {
    await expect(preview.getByText('Your photo', { exact: true })).toBeVisible()
    await expect(preview.getByText('Meta · 175g · Good')).toBeVisible()
  }
  await expect(rowOf(page, 'Origin')).toHaveAttribute('aria-current', 'true')
  await page.screenshot({ path: info.outputPath('list-preview-photo.png'), scale: 'css' })
  await point('Destroyer')
  await expect(preview.getByRole('img', { name: 'Destroyer stock illustration' })).toBeVisible()
  await expect(preview.getByText('Origin', { exact: true })).toHaveCount(0)
  await expect(rowOf(page, 'Origin')).not.toHaveAttribute('aria-current', 'true')
  await page.screenshot({ path: info.outputPath('list-preview-stock.png'), scale: 'css' })
  await rowOf(page, 'Buzzz').focus()
  await expect(preview.getByRole('img', { name: 'Buzzz stock illustration' })).toBeVisible()
  expect(external).toEqual([])
})

test('a row can be edited from the list, and search keeps the groups and counts right', async ({ page }) => {
  await seeded(page)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await page.getByPlaceholder('Search discs...', { exact: false }).fill('innova')
  await expect(page.getByRole('heading', { level: 3 })).toHaveText(['Putter (1)', 'Fairway Driver (1)', 'Distance Driver (1)'])
  await expect(page.getByText('3 of 8 discs')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Aviar', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Edit Disc' })).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: /Disc Name/ })).toHaveValue('Aviar')
})

test('the chosen view survives a reload, and each view starts on its own sort order', async ({ page }) => {
  await seeded(page)
  const sort = page.locator('select').filter({ has: page.locator('option[value="name-asc"]') })
  const cards = page.getByRole('button', { name: 'Cards', exact: true })
  const list = page.getByRole('button', { name: 'List', exact: true })
  await expect(cards).toHaveAttribute('aria-pressed', 'true')
  await expect(sort).toHaveValue('added-desc')
  await list.click()
  await expect(list).toHaveAttribute('aria-pressed', 'true')
  await expect(sort).toHaveValue('name-asc')
  expect(await page.evaluate(() => localStorage.getItem('griplock.inventoryView'))).toBe('list')
  await page.reload()
  await expect(list).toHaveAttribute('aria-pressed', 'true')
  await expect(sort).toHaveValue('name-asc')
  await expect(page.getByRole('heading', { level: 3 }).first()).toHaveText('Putter (2)')
  await cards.click()
  await expect(cards).toHaveAttribute('aria-pressed', 'true')
  await expect(sort).toHaveValue('added-desc')
  expect(await page.evaluate(() => localStorage.getItem('griplock.inventoryView'))).toBe('cards')
  await sort.selectOption('speed-desc')
  await list.click()
  await expect(sort).toHaveValue('speed-desc')
})
