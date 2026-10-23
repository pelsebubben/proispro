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

const choosePhoto = (page: Page, buffer: Buffer, name = 'photo.png') =>
  page.getByLabel('Personal photo', { exact: true }).setInputFiles({ name, mimeType: 'image/png', buffer })

// A chosen photo opens in the crop step; nothing is kept until the player confirms the framing.
async function useCrop(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Crop photo' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Use photo', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Crop photo' })).toHaveCount(0)
}

// Red, green and blue thirds make the framing of a crop visible in the saved JPEG.
async function stripedPhoto() {
  const stripe = (background: string) => sharp({ create: { width: 600, height: 1200, channels: 3, background } }).png().toBuffer()
  return sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#000000' } })
    .composite([
      { input: await stripe('#ff0000'), left: 0, top: 0 },
      { input: await stripe('#00ff00'), left: 600, top: 0 },
      { input: await stripe('#0000ff'), left: 1200, top: 0 },
    ]).png().toBuffer()
}

// Size of a saved photo plus its dominant colour in four vertical bands, left to right.
async function savedPhoto(photo: unknown) {
  const jpeg = sharp(Buffer.from(String(photo).split(',')[1], 'base64'))
  const { width, height } = await jpeg.metadata()
  const { data, info } = await jpeg.resize(4, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true })
  const names = ['red', 'green', 'blue']
  const bands = Array.from({ length: 4 }, (_, band) => {
    const pixel = [...data.subarray(band * info.channels, band * info.channels + 3)]
    return names[pixel.indexOf(Math.max(...pixel))]
  })
  return { width, height, bands }
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

test('personal photo is cropped, saved, reloaded, replaced and removed without losing disc details', async ({ page }, info) => {
  const { writes, discs } = await inventory(page)
  const dialog = page.getByRole('dialog')
  await page.getByRole('combobox', { name: /Disc Name/ }).fill('Photo disc')
  await page.getByLabel('Edition / Run').fill('My tournament run')
  await page.getByLabel('Type', { exact: false }).selectOption('utility')
  const photo = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#3989b8' } }).png().toBuffer()
  const chooser = page.waitForEvent('filechooser')
  await dialog.getByRole('button', { name: 'Add photo', exact: true }).click()
  await (await chooser).setFiles({ name: 'personal.png', mimeType: 'image/png', buffer: photo })
  await useCrop(page)
  await expect(dialog.getByRole('button', { name: 'Change photo', exact: true })).toBeFocused()
  await expect(dialog.getByAltText('Photo disc personal photo')).toBeVisible()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(writes[0].photo).toMatch(/^data:image\/jpeg;base64,/)
  expect(await savedPhoto(writes[0].photo)).toMatchObject({ width: 1024, height: 1024 })
  await page.reload()
  const image = page.getByAltText('Photo disc personal photo')
  await expect(image).toBeVisible()
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(1024)
  await page.screenshot({ path: info.outputPath('personal-photo.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await page.screenshot({ path: info.outputPath('edit-with-photo.png'), scale: 'css' })
  const replacement = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ce7744' } }).png().toBuffer()
  await choosePhoto(page, replacement, 'replacement.png')
  await useCrop(page)
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(writes[1].photo).not.toBe(writes[0].photo)
  expect(await savedPhoto(writes[1].photo)).toMatchObject({ width: 300, height: 300 })
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
  await expect(page.getByRole('heading', { name: 'Crop photo' })).toHaveCount(0)
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
  await dialog.getByRole('button', { name: 'Adjust crop', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Photo could not be loaded (503).')
  const photo = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#3989b8' } }).png().toBuffer()
  await choosePhoto(page, photo, 'recovery.png')
  await useCrop(page)
  await expect(dialog.getByAltText('Recovery disc personal photo')).toBeVisible()
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Photo unavailable. Retry' })).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('photo-recovery.png'), scale: 'css' })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(writes).toEqual([])
})

test('the crop keeps the centre square untouched, and Adjust crop re-crops a stored photo without upscaling', async ({ page }) => {
  const { writes } = await inventory(page)
  const dialog = page.getByRole('dialog')
  await page.getByRole('combobox', { name: /Disc Name/ }).fill('Adjusted disc')
  await page.getByLabel('Type', { exact: false }).selectOption('putter')
  await choosePhoto(page, await stripedPhoto())
  await useCrop(page)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await savedPhoto(writes[0].photo)).toEqual({ width: 1024, height: 1024, bands: ['red', 'green', 'green', 'blue'] })
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await dialog.getByRole('button', { name: 'Adjust crop', exact: true }).click()
  await dialog.getByRole('slider', { name: /^Zoom/ }).fill('2')
  await expect(dialog.locator('output')).toHaveText('2.0×')
  await useCrop(page)
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await savedPhoto(writes[1].photo)).toEqual({ width: 512, height: 512, bands: ['green', 'green', 'green', 'green'] })
})

test('dragging the photo moves the square window, and what is inside it is what gets saved', async ({ page }, info) => {
  const { writes } = await inventory(page)
  const dialog = page.getByRole('dialog')
  await page.getByRole('combobox', { name: /Disc Name/ }).fill('Dragged disc')
  await page.getByLabel('Type', { exact: false }).selectOption('putter')
  await choosePhoto(page, await stripedPhoto())
  const stage = dialog.getByRole('group', { name: /^Crop area/ })
  await expect(stage).toBeFocused()
  const frame = (await stage.boundingBox())!
  expect(frame.width).toBeGreaterThan(200)
  expect(Math.abs(frame.width - frame.height)).toBeLessThan(1)
  await page.screenshot({ path: info.outputPath('cropper.png'), scale: 'css' })
  const middle = frame.y + frame.height / 2
  await page.mouse.move(frame.x + frame.width * 0.1, middle)
  await page.mouse.down()
  await page.mouse.move(frame.x + frame.width * 0.9, middle, { steps: 8 })
  await page.mouse.up()
  await dialog.getByRole('button', { name: 'Use photo', exact: true }).click()
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  expect(await savedPhoto(writes[0].photo)).toEqual({ width: 1024, height: 1024, bands: ['red', 'red', 'green', 'green'] })
})

test('Escape, Reset and Cancel leave the crop step without closing the form or keeping a photo', async ({ page }) => {
  const { writes } = await inventory(page)
  const dialog = page.getByRole('dialog')
  const stage = dialog.getByRole('group', { name: /^Crop area/ })
  const picture = stage.locator('img')
  const photo = await stripedPhoto()
  await choosePhoto(page, photo)
  await expect(stage).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog.getByRole('heading', { name: 'Add Disc' })).toBeVisible()
  // The file came straight from the hidden input, so focus falls back to the photo button instead of the page body.
  await expect(dialog.getByRole('button', { name: 'Add photo', exact: true })).toBeFocused()
  await choosePhoto(page, photo)
  const framing = await picture.getAttribute('style')
  await page.keyboard.press('+')
  await expect(dialog.locator('output')).toHaveText('1.1×')
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => picture.getAttribute('style')).not.toBe(framing)
  await dialog.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(dialog.locator('output')).toHaveText('1.0×')
  await expect(picture).toHaveAttribute('style', framing!)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog.getByRole('heading', { name: 'Add Disc' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Add photo', exact: true })).toBeFocused()
  expect(writes).toEqual([])
})
