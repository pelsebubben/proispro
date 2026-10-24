import { osmAttribution } from './osm-catalog.mjs'
import { pdgaAttribution } from './pdga-client.mjs'

export async function courseRequest({ req, url, pool, json, pdga = null }) {
  if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' })
  const pdgaMatch = url.pathname.match(/^\/api\/v1\/courses\/(pdga:[1-9][0-9]{0,15})\/holes$/)
  if (pdgaMatch && !url.search) {
    if (!pdga) return json(503, { error: 'pdga_not_configured' })
    try {
      const { value: course, expiresAt } = await pdga.course(pdgaMatch[1])
      if (!course) return json(404, { error: 'course_not_found' })
      return json(200, { course, holes: [], attribution: pdgaAttribution, expiresAt,
        coverage: { mappedHoles: 0, expectedHoles: course.expected_holes, countMatches: false,
          layoutsAvailable: false,
          note: 'PDGA supplies course details and a hole count, not individual layouts through this API. Hole-by-hole planning is unavailable for this source.' } })
    } catch (error) { return json(503, { error: error.code ?? 'pdga_unavailable' }) }
  }
  const client = await pool.connect()
  let result
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SET LOCAL statement_timeout='5s'")
    const respond = (status, body) => ({ status, body })
    result = await readCatalogue({ url, pool: client, json: respond })
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  if (url.pathname === '/api/v1/courses' && result.status === 200) {
    const query = url.searchParams.get('q')?.trim() ?? ''
    let provider = { status: pdga ? 'ready' : 'not_configured' }
    if (pdga && query.length >= 2) {
      try {
        const { value: courses, expiresAt } = await pdga.search(query)
        result.body.courses.push(...courses.map(course => ({ ...course, expiresAt })))
        provider = { status: 'ready', expiresAt }
      } catch (error) { provider = { status: 'unavailable', error: error.code ?? 'pdga_unavailable' } }
    }
    result.body.providers = { pdga: provider }
    result.body.attributions = [osmAttribution, pdgaAttribution]
  }
  return json(result.status, result.body)
}

async function readCatalogue({ url, pool, json }) {
  const fields = 'id,name,city,country,latitude AS lat,longitude AS lon,expected_holes,synced_at'
  const status = (await pool.query(`SELECT source_timestamp,completed_at,report FROM course_catalog.sync_runs
    WHERE country='NO' ORDER BY completed_at DESC LIMIT 1`)).rows[0]
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
    const courses = q.length < 2 ? [] : (await pool.query(`SELECT ${fields},'osm' AS source,NULL::text AS source_url,
      (SELECT count(*)::int FROM course_catalog.holes h WHERE h.course_id=c.id) AS mapped_holes
      FROM course_catalog.courses c WHERE active AND country='NO'
      AND strpos(lower(name),lower($1))>0 ORDER BY lower(name),id LIMIT 30`, [q])).rows
    return json(200, { courses, attribution, sync: status ?? null, osmAvailable: Boolean(status) })
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
