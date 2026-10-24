import { osmAttribution } from './osm-catalog.mjs'
import { pdgaAttribution } from './pdga-client.mjs'

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
  const pdgaStatus = (await pool.query('SELECT completed_at,fetched_at,course_count FROM pdga_catalog.sync_runs ORDER BY completed_at DESC LIMIT 1')).rows[0]
  const attribution = osmAttribution
  if (url.pathname === '/api/v1/courses/export' && !url.search) {
    if (!status) return json(503, { error: 'course_catalogue_not_synced' })
    const courses = (await pool.query('SELECT * FROM course_catalog.courses WHERE active ORDER BY id')).rows
    const holes = (await pool.query('SELECT * FROM course_catalog.holes ORDER BY course_id,ref,id')).rows
    return json(200, { attribution, licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
      source: 'OpenStreetMap via Overpass', sync: status, courses, holes })
  }
  if (url.pathname === '/api/v1/courses') {
    const q = url.searchParams.get('q')?.trim() ?? ''
    if (q.length > 100 || [...url.searchParams.keys()].some(k => k !== 'q')) return json(400, { error: 'invalid_query' })
    if (!status && !pdgaStatus) return json(503, { error: 'course_catalogue_not_synced' })
    const courses = q.length < 2 ? [] : (await pool.query(`SELECT * FROM (
      SELECT ${fields},'osm' AS source,NULL::text AS source_url,
      (SELECT count(*)::int FROM course_catalog.holes h WHERE h.course_id=c.id) AS mapped_holes
      FROM course_catalog.courses c WHERE active AND country='NO'
      AND strpos(lower(name),lower($1))>0
      UNION ALL SELECT ${fields},'pdga' AS source,source_url,0 AS mapped_holes
      FROM pdga_catalog.courses WHERE active AND strpos(lower(name),lower($1))>0
      ) matches ORDER BY lower(name),source,id LIMIT 30`, [q])).rows
    return json(200, { courses, attribution, attributions: [osmAttribution, pdgaAttribution],
      sync: !status ? pdgaStatus : !pdgaStatus ? status :
        new Date(status.completed_at) > new Date(pdgaStatus.completed_at) ? status : pdgaStatus,
      sources: { osm: status ?? null, pdga: pdgaStatus ?? null } })
  }
  const pdgaMatch = url.pathname.match(/^\/api\/v1\/courses\/(pdga:[1-9][0-9]{0,15})\/holes$/)
  if (pdgaMatch && !url.search) {
    if (!pdgaStatus) return json(503, { error: 'pdga_catalogue_not_synced' })
    const course = (await pool.query(`SELECT ${fields},active,'pdga' AS source,source_url
      FROM pdga_catalog.courses WHERE id=$1`, [pdgaMatch[1]])).rows[0]
    if (!course) return json(404, { error: 'course_not_found' })
    return json(200, { course, holes: [], attribution: pdgaAttribution, sync: pdgaStatus,
      coverage: { mappedHoles: 0, expectedHoles: course.expected_holes, countMatches: false,
        layoutsAvailable: false,
        note: 'PDGA supplies course details and a hole count, not individual layouts through this API. Hole-by-hole planning is unavailable for this source.' } })
  }
  const match = url.pathname.match(/^\/api\/v1\/courses\/(osm:(?:node|way|relation):[1-9][0-9]{0,15})\/holes$/)
  if (!match || url.search) return json(400, { error: 'invalid_course' })
  if (!status) return json(503, { error: 'course_catalogue_not_synced' })
  const course = (await pool.query(`SELECT ${fields},active FROM course_catalog.courses WHERE id=$1`, [match[1]])).rows[0]
  if (!course) return json(404, { error: 'course_not_found' })
  const holes = (await pool.query(`SELECT id,ref,name,par,length_m,geometry,association
    FROM course_catalog.holes WHERE course_id=$1 ORDER BY ref,id`, [course.id])).rows
  return json(200, { course, holes, attribution, sync: status,
    coverage: { mappedHoles: holes.length, expectedHoles: course.expected_holes,
      countMatches: course.expected_holes !== null && holes.length === course.expected_holes,
      note: 'OSM mapping may be incomplete. No tee/layout variants are inferred.' } })
}
