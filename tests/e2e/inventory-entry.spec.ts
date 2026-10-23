import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

async function inventory(page: Page) {
  const discs: Record<string, unknown>[] = []
  const writes: Record<string, unknown>[] = []
  const external: string[] = []
  let bytes = Buffer.alloc(0)
  await page.addInitScript(() => {
    const claims = btoa(JSON.stringify({ preferred_username: 'inventory-fixture' }))
    sessionStorage.setItem('griplock.devAccessToken', `h.${claims}.s`)
  })
  await page.route('**/*', async route => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.origin !== 'http://127.0.0.1:4173') {
      external.push(url.origin)
      return route.abort()
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript',
      body: 'window.__GRIPLOCK_RUNTIME__ = {environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}' })
    if (url.pathname === '/api/v1/session') return route.fulfill({ json: { userId: '11111111-1111-4111-8111-111111111111' } })
    if (url.pathname.startsWith('/api/v1/')) {
      expect(req.headers().authorization).toMatch(/^Bearer /)
      if (url.pathname.endsWith('/photo')) return route.fulfill({ contentType: 'image/jpeg', body: bytes })
      if (url.pathname.startsWith('/api/v1/discs') && req.method() !== 'GET') {
        const data = req.postDataJSON() as Record<string, unknown>
        writes.push(data)
        const { photo, ...fields } = data
        const disc = req.method() === 'POST' ? { ...fields, added_at: new Date().toISOString() } : discs[0]
        Object.assign(disc, fields)
        if (photo !== undefined) {
          disc.photo_version = photo ? '22222222-2222-4222-8222-222222222222' : null
          if (typeof photo === 'string') bytes = Buffer.from(photo.split(',')[1], 'base64')
        }
        if (req.method() === 'POST') discs.push(disc)
        return route.fulfill({ status: req.method() === 'POST' ? 201 : 200, json: disc })
      }
      const resource = url.pathname.split('/').at(-1)!
      return route.fulfill({ json: { [resource]: resource === 'discs' ? discs : [] } })
    }
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('button', { name: '+ Add Disc', exact: true }).click()
  return { discs, writes, external }
}

test('instant local search finds mold, manufacturer and editions without duplicate results', async ({ page }, info) => {
  const { writes, external } = await inventory(page)
  const input = page.getByRole('combobox', { name: /Disc Name/ })
  await input.fill('discmania origin')
  await expect(page.getByRole('listbox').getByRole('option')).toHaveCount(5)
  await expect(page.getByRole('option', { name: /^Origin Discmania/ })).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('catalog.png'), scale: 'css' })
  await input.fill('midnight prowl 2')
  const option = page.getByRole('option', { name: /Midnight Prowl II Discmania/ })
  await expect(option).toBeVisible()
  if (info.project.name.startsWith('mobile')) await option.tap()
  else await option.click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(input).toHaveValue('Origin')
  await expect(page.getByLabel('Edition / Run')).toHaveValue('Midnight Prowl II')
  await expect(page.getByLabel('Manufacturer', { exact: true })).toHaveValue('Discmania')
  await expect(page.getByLabel('Type', { exact: false })).toHaveValue('midrange')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Midnight Prowl II', { exact: true })).toBeVisible()
  expect(writes[0]).toMatchObject({ name: 'Origin', edition: 'Midnight Prowl II', plastic: 'Meta', speed: 5, glide: 5, turn: -1, fade: 1 })
  expect(external).toEqual([])
})

test('an expired session on save returns to sign-in with a clear message and clears the stale token', async ({ page }) => {
  const { writes } = await inventory(page)
  await page.route('**/api/v1/discs', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 401, json: { error: 'unauthorized' } })
    : route.fallback())
  await page.getByRole('combobox', { name: /Disc Name/ }).fill('Destroyer')
  await page.getByRole('option', { name: /^Destroyer Innova/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Your session expired. Please sign in again.')
  await expect(page.getByRole('button', { name: 'Sign in locally' })).toBeVisible()
  await expect(page.getByText(/401|unauthorized/)).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('griplock.devAccessToken'))).toBeNull()
  expect(writes).toEqual([])
})

test('no-match menu dismisses on blur, Tab, Escape and custom selection, then Utility saves', async ({ page }) => {
  const { writes } = await inventory(page)
  const input = page.getByRole('combobox', { name: /Disc Name/ })
  await input.fill('Not in catalogue')
  await expect(page.getByText('No matching disc. You can still add it manually.')).toBeVisible()
  await page.getByLabel('Manufacturer', { exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await input.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await input.press('Tab')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await input.click()
  await input.press('Escape')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(page.getByRole('dialog')).toBeVisible()
  await input.click()
  await page.getByRole('option', { name: /Use "Not in catalogue"/ }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.getByLabel('Type', { exact: false }).selectOption('utility')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByRole('button', { name: 'Utility', exact: true }).click()
  await expect(page.getByText('Not in catalogue', { exact: true })).toBeVisible()
  expect(writes[0].disc_type).toBe('utility')
  await page.reload()
  await expect(page.getByText('Not in catalogue', { exact: true })).toBeVisible()
})

test('keyboard selection, rapid query replacement and menu scrolling keep the current choice', async ({ page }) => {
  await inventory(page)
  const input = page.getByRole('combobox', { name: /Disc Name/ })
  await input.fill('innova')
  await input.fill('origin')
  await expect(page.getByRole('listbox').getByRole('option').first()).toContainText('Origin')
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(page.getByLabel('Edition / Run')).toHaveValue('Midnight Prowl')
  await input.fill('innova')
  await page.locator('.disc-search-menu').evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.getByRole('option', { name: /custom disc/ }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await input.fill('destroyer')
  await input.press('Enter')
  await expect(input).toHaveValue('Destroyer')
  await expect(page.getByLabel('Manufacturer', { exact: true })).toHaveValue('Innova')
  expect(await page.locator('body').evaluate(element => element.scrollWidth <= innerWidth)).toBe(true)
})

test('personal photo is resized, saved, reloaded, replaced and removed without losing disc details', async ({ page }, info) => {
  const { writes, discs } = await inventory(page)
  await page.getByRole('combobox', { name: /Disc Name/ }).fill('Photo disc')
  await page.getByLabel('Edition / Run').fill('My tournament run')
  await page.getByLabel('Type', { exact: false }).selectOption('utility')
  const photo = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#3989b8' } }).png().toBuffer()
  const upload = page.getByLabel('Personal photo', { exact: true })
  await upload.setInputFiles({ name: 'personal.png', mimeType: 'image/png', buffer: photo })
  await expect(page.getByAltText('Photo disc personal photo')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes[0].photo).toMatch(/^data:image\/jpeg;base64,/)
  const metadata = await sharp(Buffer.from(String(writes[0].photo).split(',')[1], 'base64')).metadata()
  expect(metadata.width).toBe(1024)
  expect(metadata.height).toBeLessThanOrEqual(1024)
  await page.reload()
  const image = page.getByAltText('Photo disc personal photo')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1024)
  await page.screenshot({ path: info.outputPath('personal-photo.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const replacement = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ce7744' } }).png().toBuffer()
  await upload.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: replacement })
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes[1].photo).not.toBe(writes[0].photo)
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.getByRole('button', { name: 'Remove photo', exact: true }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(writes[2].photo).toBeNull()
  expect(discs[0]).toMatchObject({ name: 'Photo disc', edition: 'My tournament run', disc_type: 'utility', photo_version: null })
  await expect(image).toHaveCount(0)
})

test('invalid photos report an actionable error and cancelling does not save a draft', async ({ page }) => {
  const { writes } = await inventory(page)
  const upload = page.getByLabel('Personal photo', { exact: true })
  await upload.setInputFiles({ name: 'not-an-image.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') })
  await expect(page.getByRole('alert')).toContainText('Choose a JPEG, PNG or WebP photo.')
  await upload.setInputFiles({ name: 'broken.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('invalid') })
  await expect(page.getByRole('alert')).toContainText('could not be opened')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(writes).toEqual([])
  await page.getByRole('button', { name: '+ Add Disc', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: /Disc Name/ })).toHaveValue('')
})

test('a failed stored photo can be replaced by a fresh local preview', async ({ page }, info) => {
  const { discs, writes } = await inventory(page)
  discs.push({ id: '11111111-1111-4111-8111-111111111112', name: 'Recovery disc', edition: '',
    disc_type: 'utility', quantity: 1, photo_version: '22222222-2222-4222-8222-222222222222' })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.route('**/photo?*', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.reload()
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Photo unavailable. Retry' })).toBeVisible()
  const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#3989b8' } }).png().toBuffer()
  await page.getByLabel('Personal photo', { exact: true }).setInputFiles({ name: 'recovery.png', mimeType: 'image/png', buffer: photo })
  await expect(dialog.getByAltText('Recovery disc personal photo')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Photo unavailable. Retry' })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('photo-recovery.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(writes).toEqual([])
})
