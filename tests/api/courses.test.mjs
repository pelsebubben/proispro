import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { createPool } from '../../server/database.mjs'
import { migrate } from '../../server/migrate.mjs'
import { provisionCourseSync } from '../../server/provision-course-sync.mjs'
import { saveCatalogue } from '../../server/sync-courses.mjs'
import { courseRequest } from '../../server/courses.mjs'
import { norwayFixture } from '../fixtures/norway-osm.mjs'
import { savePdgaCatalogue } from '../../server/sync-pdga.mjs'

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

test('PDGA catalogue stays separate, publishes atomically and reports unavailable layouts honestly', async t => {
  const admin = createPool()
  t.after(() => admin.end())
  await migrate(admin, process.env.PGAPP_PASSWORD, 'griplock_pdga_test_app')
  const syncPassword = randomBytes(32).toString('hex')
  await provisionCourseSync(admin, syncPassword, 'griplock_verify_pdga_sync', 'pdga')
  const writer = createPool({ ...process.env, PGUSER: 'griplock_verify_pdga_sync', PGPASSWORD: syncPassword })
  const reader = createPool({ ...process.env, PGUSER: 'griplock_pdga_test_app', PGPASSWORD: process.env.PGAPP_PASSWORD })
  t.after(() => writer.end())
  t.after(() => reader.end())
  for (const sql of ['SELECT * FROM course_catalog.courses', 'SELECT * FROM app_users',
    'SELECT * FROM bags', 'DELETE FROM pdga_catalog.sync_runs']) {
    await assert.rejects(writer.query(sql), { code: '42501' })
  }
  await assert.rejects(reader.query('DELETE FROM pdga_catalog.courses'), { code: '42501' })
  const snapshot = { fetchedAt: new Date().toISOString(), courses: Array.from({ length: 20 }, (_, i) => ({
    id: String(4551 + i), name: i === 0 ? 'Ekeberg PDGA fixture' : `Norway PDGA fixture ${i}`, city: 'Oslo',
    country: 'Norway', holes: 18, latitude: 59.895283, longitude: 10.786967,
    source_url: `https://www.pdga.com/node/${10000 + i}`,
  })) }
  const call = async path => {
    let result
    await courseRequest({ req: { method: 'GET' }, url: new URL(path, 'http://localhost'), pool: reader,
      json: (status, body) => { result = { status, body } } })
    return result
  }
  assert.deepEqual(await savePdgaCatalogue(writer, snapshot),
    { event: 'pdga_sync_completed', courseCount: 20, layoutsAvailable: false })
  await savePdgaCatalogue(writer, snapshot)
  assert.equal((await reader.query('SELECT count(*)::int AS n FROM pdga_catalog.courses')).rows[0].n, 20)
  const search = await call('/api/v1/courses?q=Ekeberg')
  assert.equal(search.status, 200)
  const course = search.body.courses.find(c => c.id === 'pdga:4551')
  assert.equal(course.source, 'pdga')
  assert.equal(course.source_url, 'https://www.pdga.com/node/10000')
  assert.equal(course.expected_holes, 18)
  assert.equal(course.mapped_holes, 0)
  assert.equal(search.body.sources.pdga.course_count, 20)
  const detail = await call('/api/v1/courses/pdga:4551/holes')
  assert.equal(detail.status, 200)
  assert.deepEqual(detail.body.holes, [])
  assert.equal(detail.body.coverage.layoutsAvailable, false)
  assert.equal(detail.body.coverage.countMatches, false)
  assert.equal(detail.body.attribution.license, 'PDGA API agreement')
  assert.equal((await call('/api/v1/courses/pdga:999999/holes')).status, 404)
  const exported = await call('/api/v1/courses/export')
  assert.equal(exported.status, 200)
  assert.ok(exported.body.courses.every(c => c.id.startsWith('osm:')))
  assert.ok(!JSON.stringify(exported.body).includes('PDGA'))
  await assert.rejects(savePdgaCatalogue(writer, { ...snapshot, courses: snapshot.courses.slice(0, 10) }), /smaller/)
  await assert.rejects(savePdgaCatalogue(writer, { ...snapshot, fetchedAt: new Date(Date.now() - 86400_000).toISOString() }), /stale/)
  await assert.rejects(savePdgaCatalogue(writer, { ...snapshot, courses: [...snapshot.courses, snapshot.courses[0]] }), /Invalid PDGA course/)
  const auditCount = (await reader.query('SELECT count(*)::int AS n FROM pdga_catalog.sync_runs')).rows[0].n
  await admin.query(`CREATE FUNCTION pdga_catalog.test_failure() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN RAISE EXCEPTION 'synthetic PDGA failure'; END $$;
    CREATE TRIGGER test_failure BEFORE INSERT ON pdga_catalog.courses FOR EACH ROW EXECUTE FUNCTION pdga_catalog.test_failure()`)
  try {
    await assert.rejects(savePdgaCatalogue(writer, snapshot), /synthetic PDGA failure/)
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM pdga_catalog.sync_runs')).rows[0].n, auditCount)
    assert.equal((await reader.query('SELECT count(*)::int AS n FROM pdga_catalog.courses WHERE active')).rows[0].n, 20)
  } finally {
    await admin.query('DROP TRIGGER test_failure ON pdga_catalog.courses; DROP FUNCTION pdga_catalog.test_failure()')
  }
  await savePdgaCatalogue(writer, { ...snapshot, courses: snapshot.courses.slice(0, 19) })
  assert.equal((await reader.query("SELECT active FROM pdga_catalog.courses WHERE id='pdga:4570'")).rows[0].active, false)
  await admin.query('GRANT SELECT ON course_catalog.courses TO griplock_verify_pdga_sync')
  try {
    await assert.rejects(provisionCourseSync(admin, syncPassword, 'griplock_verify_pdga_sync', 'pdga'), /cross-source/)
  } finally { await admin.query('REVOKE SELECT ON course_catalog.courses FROM griplock_verify_pdga_sync') }
})
