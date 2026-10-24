import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchNorwaySnapshot, normalizeNorway, norwayQuery } from '../../server/osm-catalog.mjs'
import { norwayFixture } from '../fixtures/norway-osm.mjs'

test('Norway import uses real relation membership, not nearby tees or generated numbering', () => {
  const fixture = norwayFixture()
  fixture.elements.push({ type: 'node', id: 999, version: 1, timestamp: new Date().toISOString(),
    lat: 60, lon: 10, tags: { disc_golf: 'tee', ref: '4' } })
  const result = normalizeNorway(fixture)
  assert.equal(result.courses.length, 13)
  assert.deepEqual(result.holes.map(h => [h.course_id, h.ref, h.par, h.length_m, h.association]), [
    ['osm:relation:20', '1', 3, 100, 'relation'], ['osm:relation:20', '2', 3, 100, 'relation'],
  ])
  assert.deepEqual(result.holes[0].geometry[0], [10, 60])
  assert.equal(result.report.unassociatedHoles, 1)
  assert.equal(result.report.coursesMatchingExpectedCount, 1)
  assert.match(norwayQuery, /"ISO3166-1"="NO"/)
  assert.doesNotMatch(norwayQuery, /around/)
})

test('only uniquely containing closed course boundaries associate unreferenced holes', () => {
  const fixture = norwayFixture()
  const boundary = { type: 'way', id: 30, version: 1, timestamp: new Date().toISOString(),
    nodes: [1, 2, 3, 4, 1], tags: { leisure: 'disc_golf_course', name: 'Bounded course' },
    geometry: [{ lat: 59.99, lon: 9.99 }, { lat: 59.99, lon: 10.01 }, { lat: 60.01, lon: 10.01 },
      { lat: 60.01, lon: 9.99 }, { lat: 59.99, lon: 9.99 }] }
  fixture.elements.push(boundary)
  let result = normalizeNorway(fixture)
  assert.equal(result.holes.find(h => h.ref === '3').association, 'boundary')
  fixture.elements.push({ ...boundary, id: 31 })
  result = normalizeNorway(fixture)
  assert.equal(result.report.ambiguousHoles, 1)
  assert.equal(result.holes.length, 2)
})

test('duplicate hole numbers and missing refs are reported, never invented or silently overwritten', () => {
  const fixture = norwayFixture()
  fixture.elements.find(e => e.id === 102).tags.ref = '1'
  assert.equal(normalizeNorway(fixture).report.ambiguousHoles, 2)
  assert.equal(normalizeNorway(fixture).holes.length, 0)
  delete fixture.elements.find(e => e.id === 103).tags.ref
  assert.equal(normalizeNorway(fixture).report.invalidHoles, 1)
})

test('a hole segment crossing outside a concave boundary is not assigned despite endpoints being inside', () => {
  const fixture = norwayFixture()
  fixture.elements = fixture.elements.filter(e => e.type === 'node')
  const geometry = [[10, 60], [10.006, 60], [10.006, 60.006], [10.004, 60.006],
    [10.004, 60.002], [10.002, 60.002], [10.002, 60.006], [10, 60.006], [10, 60]]
    .map(([lon, lat]) => ({ lon, lat }))
  fixture.elements.push({ type: 'way', id: 50, version: 1, timestamp: fixture.osm3s.timestamp_osm_base,
    tags: { leisure: 'disc_golf_course', name: 'Concave boundary' }, geometry,
    nodes: [1, 2, 3, 4, 5, 6, 7, 8, 1] },
  { type: 'way', id: 51, version: 1, timestamp: fixture.osm3s.timestamp_osm_base,
    tags: { disc_golf: 'hole', ref: '1' },
    geometry: [{ lat: 60.004, lon: 10.001 }, { lat: 60.004, lon: 10.005 }] })
  const result = normalizeNorway(fixture)
  assert.equal(result.holes.length, 0)
  assert.equal(result.report.unassociatedHoles, 1)
})

test('rejects partial, stale, invalid metadata and out-of-region snapshots', () => {
  for (const transform of [
    f => { f.remark = 'runtime error: timed out' },
    f => { f.osm3s.timestamp_osm_base = '2020-01-01' },
    f => { delete f.elements[0].version },
    f => { f.elements[0].lat = 10 },
    f => { f.elements.push(f.elements[0]) },
  ]) {
    const fixture = norwayFixture()
    transform(fixture)
    assert.throws(() => normalizeNorway(fixture))
  }
})

test('bounded fetch retries a provider failure and rejects incomplete results from both providers', async () => {
  let calls = 0
  const fixture = norwayFixture()
  const result = await fetchNorwaySnapshot(async (url, options) => {
    assert.equal(options.redirect, 'error')
    assert.ok(options.signal)
    assert.match(options.body.get('data'), /NO/)
    calls++
    return calls === 1 ? new Response('busy', { status: 429 }) : Response.json(fixture)
  })
  assert.equal(calls, 2)
  assert.equal(result.elements.length, fixture.elements.length)
  await assert.rejects(fetchNorwaySnapshot(async () => Response.json({ remark: 'timeout', elements: [] })),
    /existing catalogue unchanged/)
})
