import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const bagId = '00000000-0000-4000-8000-000000000001'
const pinId = '00000000-0000-4000-8000-000000000002'
const course = { id: 'osm:way:123', name: 'Norway fixture course', city: 'Oslo', expected_holes: 18,
  mapped_holes: 2, lat: 60, lon: 10, active: true }
const sync = { completed_at: '2026-10-24T12:00:00Z' }
async function setup(page: Page, existing = false) {
  const state = { pins: existing ? [{ id: pinId, course_name: course.name, course_id: course.id, bag_id: bagId,
    created_at: sync.completed_at }] : [], failSearch: false, failHoles: false, empty: false, external: [] as string[] }
  await page.addInitScript(() => {
    sessionStorage.setItem('griplock.devAccessToken', `h.${btoa(JSON.stringify({ preferred_username: 'courses-fixture' }))}.s`)
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.origin !== 'http://127.0.0.1:4173') {
      state.external.push(url.origin)
      return route.abort()
    }
    if (url.pathname === '/runtime-config.js') return route.fulfill({ contentType: 'text/javascript',
      body: 'window.__GRIPLOCK_RUNTIME__={environment:"local-dev",dataBackend:"api",identityReady:true,devAuth:true}' })
    if (url.pathname === '/api/v1/session') return route.fulfill({ json: { userId: bagId } })
    if (url.pathname === '/api/v1/bags') return route.fulfill({ json: { bags: [{ id: bagId, name: 'Main', disc_ids: [] }] } })
    if (url.pathname === '/api/v1/courses') return state.failSearch
      ? route.fulfill({ status: 503, json: { error: 'course_catalogue_not_synced' } })
      : route.fulfill({ json: { courses: [course], sync } })
    if (url.pathname === '/api/v1/courses/export') return route.fulfill({ json: {
      courses: [course], holes: [], sync, attribution: { license: 'ODbL-1.0' },
    } })
    if (url.pathname.endsWith('/holes')) return state.failHoles
      ? route.fulfill({ status: 503, json: { error: 'service_unavailable' } })
      : route.fulfill({ json: { course, sync, coverage: { note: 'OSM mapping may be incomplete. No tee/layout variants are inferred.' },
        holes: state.empty ? [] : [
          { ref: '10', name: 'Long hole', par: 4, length_m: 180, geometry: [[10, 60], [10.001, 60.001]] },
          { ref: '2', name: 'Short hole', par: 3, length_m: 90, geometry: [[10, 60], [10.001, 60.001]] },
        ] } })
    if (url.pathname === '/api/v1/course_pins') {
      if (route.request().method() === 'POST') {
        const row = { ...route.request().postDataJSON(), id: pinId, created_at: sync.completed_at }
        state.pins.push(row)
        return route.fulfill({ status: 201, json: row })
      }
      return route.fulfill({ json: { course_pins: state.pins } })
    }
    if (url.pathname.startsWith('/api/v1/')) return route.fulfill({ json: { [url.pathname.split('/').at(-1)!]: [] } })
    return route.continue()
  })
  await page.goto('/')
  await page.getByRole('navigation').getByRole('button', { name: /Courses/ }).click()
  return state
}

test('Norway catalogue pins a stable source ID and loads stored holes after a reload without Overpass', async ({ page }) => {
  const state = await setup(page)
  await page.getByRole('button', { name: '+ Pin Course', exact: true }).click()
  await page.getByRole('textbox', { name: /Course Name/ }).fill('Norway')
  await page.getByRole('button', { name: /Norway fixture course.*2 mapped \/ 18 listed/ }).click()
  await page.getByRole('button', { name: 'Save Pin', exact: true }).click()
  await expect(page.getByRole('heading', { name: course.name })).toBeVisible()
  expect(state.pins[0].course_id).toBe(course.id)
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: /Courses/ }).click()
  await page.getByRole('button', { name: 'Load holes', exact: true }).click()
  await expect(page.getByText(/OSM mapping may be incomplete/)).toBeVisible()
  await page.getByRole('button', { name: /Holes \(2\)/ }).click()
  const short = page.getByText('Hole 2 - Short hole · Par 3 · 90 m', { exact: true })
  await expect(short).toBeVisible()
  await expect(page.getByText('Hole 10 - Long hole · Par 4 · 180 m', { exact: true })).toBeVisible()
  expect(await page.locator('body').evaluate(body => body.scrollWidth <= innerWidth)).toBe(true)
  expect(state.external).toEqual([])
  await expect(page.getByRole('link', { name: /OpenStreetMap contributors/ })).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download ODbL course data', exact: true }).click()
  const file = await downloaded
  expect(file.suggestedFilename()).toBe('griplock-norway-osm-catalogue.json')
  const exported = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(exported.courses[0].id).toBe(course.id)
  expect(exported.attribution.license).toBe('ODbL-1.0')
  expect(exported.course_pins).toBeUndefined()
})

test('catalogue failures stay visible and empty mapping is not presented as a complete course', async ({ page }) => {
  const state = await setup(page, true)
  state.failHoles = true
  await page.getByRole('button', { name: 'Load holes', exact: true }).click()
  await expect(page.getByRole('alert').last()).toBeVisible()
  state.failHoles = false
  state.empty = true
  await page.getByRole('button', { name: 'Load holes', exact: true }).click()
  await expect(page.getByText(/This does not mean the course has no holes/)).toBeVisible()
  state.failSearch = true
  await page.getByRole('button', { name: '+ Pin Course', exact: true }).click()
  await page.getByRole('textbox', { name: /Course Name/ }).fill('Norway')
  await expect(page.getByRole('alert').last()).toBeVisible()
  await expect(page.getByText(/No matching Norwegian courses/)).toHaveCount(0)
  state.failSearch = false
  await page.getByRole('textbox', { name: /Course Name/ }).fill('Norway fixture')
  await expect(page.getByRole('button', { name: /Norway fixture course.*mapped/ })).toBeVisible()
  expect(state.external).toEqual([])
})
