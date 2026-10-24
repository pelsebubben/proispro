import { osmAttribution } from './osm-catalog.mjs'

export async function courseRequest({ req, url, pool, json }) {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' })
  const client = await pool.connect()
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout='5s'")
    const respond = (status, body) => ({ status, body })
    const result = await readCatalogue({ url, pool: client, json: respond })
    await client.query('COMMIT')
    return json(result.status, result.body)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

async function readCatalogue({ url, pool, json }) {
  const fields = 'id,name,city,country,latitude AS lat,longitude AS lon,expected_holes,synced_at'
  const status = (await pool.query(`SELECT source_timestamp,completed_at,report FROM course_catalog.sync_runs
    WHERE country='NO' ORDER BY completed_at DESC LIMIT 1`)).rows[0]
  if (!status) return json(503, { error: 'course_catalogue_not_synced' })
  const attribution = osmAttribution
  if (url.pathname === '/api/v1/courses/export' && !url.search) {
    const courses = (await pool.query('SELECT * FROM course_catalog.courses WHERE active ORDER BY id')).rows
    const holes = (await pool.query('SELECT * FROM course_catalog.holes ORDER BY course_id,ref,id')).rows
    return json(200, { attribution, licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      source: 'OpenStreetMap via Overpass', sync: status, courses, holes })
  }
  if (url.pathname === '/api/v1/courses') {
    const q = url.searchParams.get('q')?.trim() ?? ''
    if (q.length > 100 || [...url.searchParams.keys()].some(k => k !== 'q')) return json(400, { error: 'invalid_query' })
    const courses = q.length < 2 ? [] : (await pool.query(`SELECT ${fields},
      (SELECT count(*)::int FROM course_catalog.holes h WHERE h.course_id=c.id) AS mapped_holes
      FROM course_catalog.courses c WHERE active AND country='NO'
      AND strpos(lower(name),lower($1))>0 ORDER BY lower(name),id LIMIT 30`, [q])).rows
    return json(200, { courses, attribution, sync: status })
  }
  const match = url.pathname.match(/^\/api\/v1\/courses\/(osm:(?:node|way|relation):[1-9][0-9]{0,15})\/holes$/)
  if (!match || url.search) return json(400, { error: 'invalid_course' })
  const course = (await pool.query(`SELECT ${fields},active FROM course_catalog.courses WHERE id=$1`, [match[1]])).rows[0]
  if (!course) return json(404, { error: 'course_not_found' })
  const holes = (await pool.query(`SELECT id,ref,name,par,length_m,geometry,association
    FROM course_catalog.holes WHERE course_id=$1 ORDER BY ref,id`, [course.id])).rows
  return json(200, { course, holes, attribution, sync: status,
    coverage: { mappedHoles: holes.length, expectedHoles: course.expected_holes,
      countMatches: course.expected_holes !== null && holes.length === course.expected_holes,
      note: 'OSM mapping may be incomplete. No tee/layout variants are inferred.' } })
}
