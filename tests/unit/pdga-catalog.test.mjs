import assert from 'node:assert/strict'
import test from 'node:test'
import { searchPdga, readPdgaCourse } from '../../server/pdga-client.mjs'
import { createPdgaService, pdgaCacheMs } from '../../server/pdga-service.mjs'
import { courseRequest } from '../../server/courses.mjs'

const credentials = { username: 'fixture', password: 'synthetic-test-only' }
const session = { session_name: 'SSESS_fixture', sessid: 'fixture', token: 'fixture' }
const record = { course_id: '4551', course_node_nid: '10000', course_name: 'Ekeberg', country: 'Norway',
  city: 'Oslo', holes: '18', latitude: '59.9', longitude: '10.7', contact_email: 'PRIVATE' }
function fixture() {
  const calls = []
  const state = { fail: false, records: [record] }
  return { calls, state, fetcher: async (url, options) => {
    calls.push(new URL(url))
    assert.equal(new URL(url).origin, 'https://api.pdga.com')
    assert.equal(options.redirect, 'error')
    if (url.endsWith('/login')) return Response.json(session)
    if (url.endsWith('/logout')) return Response.json(true)
    assert.equal(new URL(url).searchParams.get('country'), 'NO')
    assert.equal(new URL(url).searchParams.has('offset'), false)
    return state.fail ? new Response('PRIVATE', { status: 502 }) : Response.json({ courses: state.records })
  } }
}
test('PDGA uses one bounded user search or exact ID lookup, not country replication or pagination', async () => {
  const api = fixture()
  const courses = await searchPdga(credentials, 'Ekeberg', api.fetcher)
  assert.equal(courses[0].id, 'pdga:4551')
  assert.equal(courses[0].source_url, 'https://www.pdga.com/node/10000')
  assert.equal(api.calls.length, 3)
  assert.equal(api.calls[1].searchParams.get('course_name'), 'Ekeberg')
  assert.equal(api.calls[1].searchParams.get('limit'), '30')
  assert.ok(!JSON.stringify(courses).includes('PRIVATE'))
  assert.equal((await readPdgaCourse(credentials, 'pdga:4551', api.fetcher)).id, 'pdga:4551')
  assert.equal(api.calls[4].searchParams.get('course_id'), '4551')
  assert.equal(api.calls[4].searchParams.get('limit'), '1')
  assert.throws(() => searchPdga(credentials, ''), /Invalid PDGA search/)
  assert.throws(() => readPdgaCourse(credentials, 'osm:4551'), /Invalid PDGA course/)
})
test('temporary cache expires, never serves stale on error, and can be purged immediately', async t => {
  let time = 1000
  const api = fixture()
  const logs = []
  const service = createPdgaService({ ...credentials, fetcher: api.fetcher, now: () => time, logger: event => logs.push(event) })
  t.after(() => service.close())
  const first = await service.search('Ekeberg')
  assert.equal(first.expiresAt, time + pdgaCacheMs)
  assert.deepEqual(await service.search('ekeberg'), first)
  assert.equal((await service.course('pdga:4551')).value.name, 'Ekeberg')
  assert.equal(api.calls.length, 3)
  time += pdgaCacheMs
  api.state.fail = true
  await assert.rejects(service.course('pdga:4551'), { code: 'pdga_unavailable' })
  assert.equal(api.calls.length, 6)
  assert.deepEqual(logs, [{ event: 'pdga_request_failed', code: 'pdga_unavailable' }])
  api.state.fail = false
  await service.search('Ekeberg')
  service.clear()
  await service.search('Ekeberg')
  assert.equal(api.calls.length, 12)
  assert.equal(createPdgaService(), null)
  assert.throws(() => createPdgaService({ username: 'one' }), /Both PDGA/)
})
test('concurrent identical searches coalesce; other requests and bursts are bounded', async t => {
  const api = fixture()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const service = createPdgaService({ ...credentials, fetcher: async (...args) => { await gate; return api.fetcher(...args) } })
  t.after(() => service.close())
  const first = service.search('Ekeberg')
  const second = service.search('Ekeberg')
  await assert.rejects(service.search('Other'), { code: 'pdga_busy' })
  release()
  assert.deepEqual(await first, await second)
  assert.equal(api.calls.length, 3)
  for (let i = 0; i < 19; i++) await service.search(`Course ${i}`)
  await assert.rejects(service.search('More'), { code: 'pdga_rate_limited' })
})
test('PDGA detail needs no SQL, returns no invented layouts, and exposes unavailability', async t => {
  const api = fixture()
  const service = createPdgaService({ ...credentials, fetcher: api.fetcher })
  t.after(() => service.close())
  const call = async (pdga, path = '/api/v1/courses/pdga:4551/holes') => {
    let result
    await courseRequest({ req: { method: 'GET' }, url: new URL(path, 'http://localhost'),
      pool: { connect: () => { throw new Error('PDGA content must not touch SQL') } }, pdga,
      json: (status, body) => { result = { status, body } } })
    return result
  }
  const detail = await call(service)
  assert.equal(detail.status, 200)
  assert.deepEqual(detail.body.holes, [])
  assert.equal(detail.body.coverage.layoutsAvailable, false)
  assert.equal(detail.body.coverage.countMatches, false)
  assert.equal(detail.body.attribution.text, 'Player, event, and course data provided by PDGA.')
  assert.equal((await call(null)).body.error, 'pdga_not_configured')
  service.clear()
  api.state.fail = true
  assert.equal((await call(service)).body.error, 'pdga_unavailable')
})
