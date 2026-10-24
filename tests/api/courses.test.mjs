import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { createPool } from '../../server/database.mjs'
import { migrate } from '../../server/migrate.mjs'
import { provisionCourseSync } from '../../server/provision-course-sync.mjs'
import { saveCatalogue } from '../../server/sync-courses.mjs'
import { courseRequest } from '../../server/courses.mjs'
import { norwayFixture } from '../fixtures/norway-osm.mjs'
import { createPdgaService } from '../../server/pdga-service.mjs'
import { featureRequest } from '../../server/features.mjs'
import { Readable } from 'node:stream'

test('real SQL catalogue is atomic, searchable, idempotent, and isolated from runtime and private data', async t => {
  const admin = createPool()
  t.after(() => admin.end())
  await migrate(admin, process.env.PGAPP_PASSWORD, 'griplock_catalogue_app')
  const syncPassword = randomBytes(32).toString('hex')
  await provisionCourseSync(admin, syncPassword, 'griplock_verify_courses_sync')
  const worker = createPool({ ...process.env, PGUSER: 'griplock_verify_courses_sync', PGPASSWORD: syncPassword })
  const reader = createPool({ ...process.env, PGUSER: 'griplock_catalogue_app', PGPASSWORD: process.env.PGAPP_PASSWORD })
  t.after(() => worker.end())
  t.after(() => reader.end())
  assert.equal((await worker.query(`SELECT rolsuper OR rolbypassrls OR rolcreaterole AS elevated
    FROM pg_roles WHERE rolname=current_user`)).rows[0].elevated, false)
  for (const sql of ['SELECT * FROM app_users', 'SELECT * FROM bags', 'SELECT * FROM disc_photos',
    'INSERT INTO owned_discs(name) VALUES (\'no\')', 'DELETE FROM course_catalog.sync_runs']) {
    await assert.rejects(worker.query(sql), { code: '42501' })
  }
  await assert.rejects(reader.query('DELETE FROM course_catalog.courses'), { code: '42501' })
  const fixture = norwayFixture()
  const first = await saveCatalogue(worker, fixture)
  assert.equal(first.importedCourses, 13)
  await saveCatalogue(worker, fixture)
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM course_catalog.courses WHERE active')).rows[0].n, 13)
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM course_catalog.holes')).rows[0].n, 2)
  const auditCount = (await reader.query('SELECT count(*)::int AS n FROM course_catalog.sync_runs')).rows[0].n
  await admin.query(`CREATE FUNCTION course_catalog.test_failure() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'synthetic catalogue insert failure'; END $$;
    CREATE TRIGGER test_failure BEFORE INSERT ON course_catalog.holes FOR EACH ROW EXECUTE FUNCTION course_catalog.test_failure()`)
  try {
    await assert.rejects(saveCatalogue(worker, fixture), /synthetic catalogue/)
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM course_catalog.holes')).rows[0].n, 2)
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM course_catalog.sync_runs')).rows[0].n, auditCount)
  } finally {
    await admin.query('DROP TRIGGER test_failure ON course_catalog.holes; DROP FUNCTION course_catalog.test_failure()')
  }
  const call = async (path, method = 'GET') => {
    let result
    await courseRequest({ req: { method }, url: new URL(path, 'http://localhost'), pool: reader,
      json: (status, body) => { result = { status, body } } })
    return result
  }
  const search = await call('/api/v1/courses?q=Explicit')
  const exported = await call('/api/v1/courses/export')
  assert.equal(exported.body.courses.length, 13)
  assert.equal(exported.body.holes.length, 2)
  assert.equal(exported.body.courses[0].source_version, 1)
  assert.equal(exported.body.licenseUrl, 'https://opendatacommons.org/licenses/odbl/1-0/')
  assert.deepEqual(Object.keys(exported.body).sort(), ['attribution', 'courses', 'holes', 'licenseUrl', 'source', 'sync'])
  assert.equal(search.status, 200)
  assert.equal(search.body.courses[0].mapped_holes, 2)
  assert.equal(search.body.attribution.license, 'ODbL-1.0')
  assert.equal((await call('/api/v1/courses?q=%27%20OR%201%3D1--')).body.courses.length, 0)
  assert.equal((await call('/api/v1/courses?country=SE')).status, 400)
  assert.equal((await call('/api/v1/courses', 'POST')).status, 405)
  assert.equal((await call('/api/v1/courses/osm:relation:20/holes')).body.holes.length, 2)
  assert.equal((await call('/api/v1/courses/osm:node:9999/holes')).status, 404)
  const smaller = norwayFixture()
  smaller.elements = smaller.elements.filter(e => e.type === 'node')
  await assert.rejects(saveCatalogue(worker, smaller), /shrank/)
  const old = structuredClone(fixture)
  old.osm3s.timestamp_osm_base = new Date(Date.now() - 3600_000).toISOString()
  await assert.rejects(saveCatalogue(worker, old), /older/)
  const corrupt = structuredClone(fixture)
  corrupt.remark = 'timeout'
  await assert.rejects(saveCatalogue(worker, corrupt), /partial/)
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM course_catalog.holes')).rows[0].n, 2)
  const changed = structuredClone(fixture)
  changed.osm3s.timestamp_osm_base = new Date(Date.now() + 1000).toISOString()
  changed.elements = changed.elements.filter(e => e.id !== 1)
  await saveCatalogue(worker, changed)
  assert.equal((await reader.query("SELECT active FROM course_catalog.courses WHERE id='osm:node:1'")).rows[0].active, false)
  assert.equal((await call('/api/v1/courses?q=Norway%20test%201')).body.courses.some(c => c.id === 'osm:node:1'), false)
  await admin.query('GRANT SELECT ON bags TO griplock_verify_courses_sync')
  try {
    await assert.rejects(provisionCourseSync(admin, syncPassword, 'griplock_verify_courses_sync'), /unexpected privileges/)
  } finally {
    await admin.query('REVOKE SELECT ON bags FROM griplock_verify_courses_sync')
  }
})

test('on-demand PDGA search does not create SQL content and ODbL exports exclude it', async t => {
  const admin = createPool()
  let userId
  t.after(async () => {
    try {
      if (userId) {
        await admin.query('DELETE FROM course_pins WHERE user_id=$1', [userId])
        await admin.query('DELETE FROM bags WHERE user_id=$1', [userId])
        await admin.query('DELETE FROM app_users WHERE id=$1', [userId])
      }
    } finally { await admin.end() }
  })
  await migrate(admin, process.env.PGAPP_PASSWORD, 'griplock_pdga_test_app')
  const reader = createPool({ ...process.env, PGUSER: 'griplock_pdga_test_app', PGPASSWORD: process.env.PGAPP_PASSWORD })
  t.after(() => reader.end())
  assert.equal((await admin.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname='pdga_catalog'")).rows[0].n, 0)
  const pdga = createPdgaService({ username: 'fixture', password: 'synthetic-only', fetcher: async url => {
    if (url.endsWith('/login')) return Response.json({ session_name: 'SSESS_fixture', sessid: 'fixture', token: 'fixture' })
    if (url.endsWith('/logout')) return Response.json(true)
    return Response.json({ courses: [{ course_id: '4551', course_node_nid: '10000', course_name: 'Ekeberg fixture',
      city: 'Oslo', country: 'Norway', latitude: '59.9', longitude: '10.7', holes: '18' }] })
  } })
  t.after(() => pdga.close())
  const call = async path => {
    let result
    await courseRequest({ req: { method: 'GET' }, url: new URL(path, 'http://localhost'), pool: reader, pdga,
      json: (status, body) => { result = { status, body } } })
    return result
  }
  const search = await call('/api/v1/courses?q=Ekeberg')
  assert.equal(search.status, 200)
  const course = search.body.courses.find(c => c.id === 'pdga:4551')
  assert.equal(course.source, 'pdga')
  assert.equal(course.source_url, 'https://www.pdga.com/node/10000')
  assert.equal(course.expected_holes, 18)
  assert.equal(course.mapped_holes, 0)
  assert.equal(search.body.providers.pdga.status, 'ready')
  const detail = await call('/api/v1/courses/pdga:4551/holes')
  assert.equal(detail.status, 200)
  assert.deepEqual(detail.body.holes, [])
  assert.equal(detail.body.coverage.layoutsAvailable, false)
  assert.equal(detail.body.coverage.countMatches, false)
  assert.equal(detail.body.attribution.license, 'PDGA API agreement')
  const exported = await call('/api/v1/courses/export')
  assert.equal(exported.status, 200)
  assert.ok(exported.body.courses.every(c => c.id.startsWith('osm:')))
  assert.ok(!JSON.stringify(exported.body).includes('PDGA'))
  userId = (await admin.query("INSERT INTO app_users(issuer,subject) VALUES('pdga-fixture',$1) RETURNING id",
    [randomBytes(16).toString('hex')])).rows[0].id
  const bag = (await admin.query("INSERT INTO bags(user_id,name) VALUES($1,'Fixture bag') RETURNING id", [userId])).rows[0]
  const writePin = async (body, rowId) => {
    let response
    const req = Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
      method: rowId ? 'PATCH' : 'POST', headers: { 'content-type': 'application/json' },
    })
    await featureRequest({ req, url: new URL(`/api/v1/course_pins${rowId ? `/${rowId}` : ''}`, 'http://localhost'),
      pool: reader, userId, json: (status, value) => { response = { status, value } } })
    return response
  }
  const pin = await writePin({ course_name: 'Ekeberg fixture', course_id: 'pdga:4551', bag_id: bag.id })
  assert.equal(pin.status, 201)
  assert.equal(pin.value.course_name, 'PDGA course')
  const updated = await writePin({ course_name: 'Do not retain provider name' }, pin.value.id)
  assert.equal(updated.status, 200)
  assert.equal(updated.value.course_name, 'PDGA course')
  const persisted = (await admin.query('SELECT course_name,course_id FROM course_pins WHERE id=$1', [pin.value.id])).rows[0]
  assert.deepEqual(persisted, { course_name: 'PDGA course', course_id: 'pdga:4551' })
  await assert.rejects(admin.query('UPDATE course_pins SET course_name=$1 WHERE id=$2', ['Ekeberg fixture', pin.value.id]), { code: '23514' })
  assert.equal((await writePin({ course_name: 'Invalid', course_id: 'pdga:bad', bag_id: bag.id })).status, 400)
  pdga.clear()
  const partial = await courseRequest({
    req: { method: 'GET' }, url: new URL('/api/v1/courses?q=Ekeberg', 'http://localhost'), pool: reader,
    pdga: { search: async () => { throw Object.assign(new Error('safe'), { code: 'pdga_unavailable' }) } },
    json: (status, body) => ({ status, body }),
  })
  assert.equal(partial.status, 200)
  assert.equal(partial.body.providers.pdga.status, 'unavailable')
  assert.ok(partial.body.courses.every(c => c.source === 'osm'))
})
