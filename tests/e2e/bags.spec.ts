import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const seedDiscs = [
  { id: id(1), name: 'Judge', manufacturer: 'Dynamic Discs', disc_type: 'putter', speed: 2, glide: 4, turn: 0, fade: 1 },
  { id: id(2), name: 'Aviar', manufacturer: 'Innova', disc_type: 'putter', speed: 2, glide: 3, turn: 0, fade: 1 },
  { id: id(3), name: 'Buzzz', edition: 'Tour Series', manufacturer: 'Discraft', disc_type: 'midrange', speed: 5, glide: 4, turn: -1, fade: 1,
    photo_version: id(50) },
  { id: id(4), name: 'Destroyer', manufacturer: 'Innova', disc_type: 'distance', speed: 12, glide: 5, turn: -1, fade: 3 },
].map(disc => ({ quantity: 1, tags: [], condition: 'good', added_at: '2026-01-01T00:00:00Z', ...disc }))

interface Bag { id: string; name: string; disc_ids: string[] }
async function setup(page: Page, empty = false) {
  const state = {
    bags: empty ? [] as Bag[] : [
      { id: id(10), name: 'Main', disc_ids: seedDiscs.map(disc => disc.id) },
      { id: id(11), name: 'Travel', disc_ids: [id(1)] },
    ],
    failCreate: false, failPatch: false, failLoad: false,
    creates: 0, patches: 0, gate: null as Promise<void> | null,
    dialogs: [] as string[], external: [] as string[],
  }
  page.on('dialog', async dialog => { state.dialogs.push(dialog.type()); await dialog.dismiss() })
  const photo = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#3989b8' } }).jpeg().toBuffer()
  await page.addInitScript(() => {
    const claims = btoa(JSON.stringify({ preferred_username: 'bags-fixture' }))
    sessionStorage.setItem('griplock.devAccessToken', `h.${claims}.s`)
  })
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:4173') {
      state.external.push(url.origin)
      return route.abort()
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript',
      body: 'window.__GRIPLOCK_RUNTIME__={environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}' })
    if (url.pathname === '/api/v1/session') return route.fulfill({ json: { userId: id(99) } })
    if (url.pathname.endsWith('/photo')) return route.fulfill({ contentType: 'image/jpeg', body: photo })
    if (url.pathname === '/api/v1/discs') return route.fulfill({ json: { discs: seedDiscs } })
    if (url.pathname === '/api/v1/bag_history') return route.fulfill({ json: { bag_history: [
      { id: id(70), bag_id: id(10), disc_id: id(1), disc_name: 'Judge', action: 'added', changed_at: new Date().toISOString() },
    ] } })
    if (url.pathname.startsWith('/api/v1/bags')) {
      if (request.method() === 'GET') return state.failLoad
        ? route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
        : route.fulfill({ json: { bags: state.bags } })
      if (request.method() === 'POST') {
        state.creates++
        if (state.failCreate) return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
        const bag: Bag = request.postDataJSON()
        state.bags.push(bag)
        return route.fulfill({ status: 201, json: bag })
      }
      const bagId = url.pathname.split('/').at(-1)
      if (request.method() === 'DELETE') {
        state.bags = state.bags.filter(bag => bag.id !== bagId)
        return route.fulfill({ json: { deleted: true } })
      }
      state.patches++
      if (state.gate) await state.gate
      if (state.failPatch) return route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
      const bag = state.bags.find(item => item.id === bagId)!
      Object.assign(bag, request.postDataJSON())
      return route.fulfill({ json: bag })
    }
    if (url.pathname.startsWith('/api/v1/')) {
      return route.fulfill({ json: { [url.pathname.split('/').at(-1)!]: [] } })
    }
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: /Bags/ }).click()
  return state
}

const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(`^Include ${name}\\b`) })
const noOverflow = (page: Page) => page.locator('body').evaluate(body => body.scrollWidth <= innerWidth)

test('create uses an in-page form, keeps the name on failure, and persists one usable bag', async ({ page }) => {
  const state = await setup(page, true)
  await page.getByRole('button', { name: '+ Create Bag', exact: true }).click()
  const form = page.getByRole('form', { name: 'Create Bag', exact: true })
  const name = form.getByRole('textbox', { name: 'Bag name', exact: true })
  await expect(name).toBeFocused()
  await expect(form.getByRole('button', { name: 'Create bag', exact: true })).toBeDisabled()
  await name.fill('  Wooded course  ')
  state.failCreate = true
  await name.press('Enter')
  await expect(form.getByRole('alert')).toContainText('503')
  await expect(name).toHaveValue('  Wooded course  ')
  state.failCreate = false
  await form.getByRole('button', { name: 'Create bag', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Wooded course', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Bag configuration' }).locator('option')).toHaveCount(1)
  await checkbox(page, 'Judge').click()
  await expect(checkbox(page, 'Judge')).toBeChecked()
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: /Bags/ }).click()
  await expect(page.getByRole('heading', { name: 'Wooded course', exact: true })).toBeVisible()
  await expect(checkbox(page, 'Judge')).toBeChecked()
  expect(state.bags).toHaveLength(1)
  expect(state.creates).toBe(2)
  expect(state.dialogs).toEqual([])
  expect(state.external).toEqual([])
})

test('bag list shares inventory groups, sorting, search, and personal-photo preview', async ({ page }, info) => {
  await setup(page)
  await expect(page.getByRole('heading', { name: 'Main', exact: true })).toBeVisible()
  await expect(page.locator('.disc-list-heading')).toHaveText(['Putter (2)', 'Midrange (1)', 'Distance Driver (1)'])
  const putters = page.getByRole('region', { name: /^Putter/ }).locator('.disc-row-title')
  await expect(putters).toHaveText(['Aviar', 'Judge'])
  await page.getByRole('combobox', { name: 'Sort:' }).selectOption('name-desc')
  await expect(putters).toHaveText(['Judge', 'Aviar'])
  await page.getByRole('button', { name: 'Midrange', exact: true }).click()
  await expect(page.locator('.disc-row-title')).toHaveText(['Buzzz'])
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search discs' })
  await search.fill('Tour Series')
  await expect(page.locator('.disc-row-title')).toHaveText(['Buzzz'])
  const preview = page.getByRole('complementary', { name: 'Selected disc' })
  await expect(preview.getByAltText('Buzzz personal photo')).toBeVisible()
  await expect(preview.getByAltText('Buzzz personal photo')).toHaveCSS('border-radius', '50%')
  await search.fill('missing disc')
  await expect(page.getByRole('heading', { name: 'No matching discs' })).toBeVisible()
  await search.fill('')
  await page.getByRole('combobox', { name: 'Sort:' }).selectOption('name-asc')
  await page.getByRole('button', { name: /Buzzz Tour Series/ }).focus()
  await expect(preview.getByAltText('Buzzz personal photo')).toBeVisible()
  expect(await noOverflow(page)).toBe(true)
  await page.screenshot({ path: info.outputPath('bags-list.png'), fullPage: true, scale: 'css' })
})

test('membership waits for saving, recovers from failure and leaves other configurations and inventory intact', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('combobox', { name: 'Bag configuration' }).selectOption(id(11))
  await page.getByRole('button', { name: /^All inventory/ }).click()
  let release!: () => void
  state.gate = new Promise<void>(resolve => { release = resolve })
  await checkbox(page, 'Aviar').click()
  await expect(page.getByRole('status')).toContainText('Saving...')
  await expect(checkbox(page, 'Buzzz')).toBeDisabled()
  await expect(page.getByRole('combobox', { name: 'Bag configuration' })).toBeDisabled()
  expect(state.patches).toBe(1)
  release()
  state.gate = null
  await expect(checkbox(page, 'Aviar')).toBeChecked()
  await expect(checkbox(page, 'Buzzz')).toBeEnabled()
  await checkbox(page, 'Buzzz').click()
  await expect(page.getByRole('button', { name: 'In this bag (3)', exact: true })).toBeVisible()
  state.failPatch = true
  await checkbox(page, 'Judge').click()
  await expect(page.locator('.bag-feedback[role="alert"]')).toContainText('503')
  await expect(checkbox(page, 'Judge')).toBeChecked()
  state.failPatch = false
  await checkbox(page, 'Judge').click()
  await expect(checkbox(page, 'Judge')).not.toBeChecked()
  await page.getByRole('combobox', { name: 'Bag configuration' }).selectOption(id(10))
  await expect(page.getByRole('button', { name: 'In this bag (4)', exact: true })).toBeVisible()
  await expect(checkbox(page, 'Judge')).toBeChecked()
  expect(state.bags.find(bag => bag.id === id(11))!.disc_ids).toEqual([id(2), id(3)])
  await page.getByRole('navigation').getByRole('button', { name: /Inventory/ }).click()
  await expect(page.getByText('4 discs', { exact: true })).toBeVisible()
})

test('rename, history, chart and delete work without browser dialogs', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  const name = page.getByRole('textbox', { name: 'Bag name', exact: true })
  await name.fill('Do not save')
  await name.press('Escape')
  await expect(page.getByRole('button', { name: 'Rename', exact: true })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Main', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Rename', exact: true }).click()
  await page.getByRole('textbox', { name: 'Bag name', exact: true }).fill('Core')
  await page.getByRole('button', { name: 'Save name', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Core', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'History', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Bag history' })).toContainText('Added Judge')
  await page.getByRole('button', { name: 'Flight chart', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Bag flight chart' })).toBeVisible()
  await page.getByRole('button', { name: 'Delete bag', exact: true }).click()
  const confirmation = page.getByRole('region', { name: 'Confirm bag deletion' })
  await expect(confirmation).toContainText('Your inventory discs will not be deleted')
  await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(state.bags).toHaveLength(2)
  await page.getByRole('button', { name: 'Delete bag', exact: true }).click()
  await page.getByRole('button', { name: 'Delete configuration', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Travel', exact: true })).toBeVisible()
  expect(state.bags).toHaveLength(1)
  expect(state.dialogs).toEqual([])
  expect(await noOverflow(page)).toBe(true)
})

test('failed bag loading is not shown as an empty collection and can be retried', async ({ page }) => {
  const state = await setup(page)
  state.failLoad = true
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: /Bags/ }).click()
  await expect(page.locator('.bag-feedback[role="alert"]')).toContainText('503')
  await expect(page.getByRole('heading', { name: 'No bags yet', exact: true })).toHaveCount(0)
  state.failLoad = false
  await page.getByRole('button', { name: 'Retry loading', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Main', exact: true })).toBeVisible()
})
