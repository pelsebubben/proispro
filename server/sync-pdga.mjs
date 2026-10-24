import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createPool } from './database.mjs'
import { fetchPdgaNorway } from './pdga-client.mjs'

export async function savePdgaCatalogue(pool, snapshot) {
  const time = Date.parse(snapshot?.fetchedAt)
  if (!Number.isFinite(time) || Math.abs(Date.now() - time) > 3600_000 ||
      !Array.isArray(snapshot?.courses) || snapshot.courses.length < 10 || snapshot.courses.length > 5000) {
    throw new Error('Invalid or stale PDGA snapshot; catalogue unchanged.')
  }
  const seen = new Set()
  const courses = snapshot.courses.map(c => {
    if (!/^[1-9][0-9]{0,15}$/.test(c.id) || seen.has(c.id) || typeof c.name !== 'string' ||
        !c.name.trim() || c.name.length > 300 || !['NO', 'Norway'].includes(c.country) ||
        typeof c.source_url !== 'string' || !/^https:\/\/www\.pdga\.com\/node\/[1-9][0-9]{0,15}$/.test(c.source_url) ||
        (c.holes !== null && (!Number.isInteger(c.holes) || c.holes < 1 || c.holes > 200)) ||
        (c.latitude !== null && (!Number.isFinite(c.latitude) || c.latitude < 57 || c.latitude > 82)) ||
        (c.longitude !== null && (!Number.isFinite(c.longitude) || c.longitude < -10 || c.longitude > 36))) {
      throw new Error('Invalid PDGA course; catalogue unchanged.')
    }
    seen.add(c.id)
    return { id: `pdga:${c.id}`, name: c.name.trim(), city: typeof c.city === 'string' ? c.city.slice(0, 300) : '',
      latitude: c.latitude, longitude: c.longitude, expected_holes: c.holes, source_url: c.source_url }
  })
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout='60s'")
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(72491924) AS locked')
    if (!lock.rows[0].locked) throw new Error('Another PDGA publication is already running.')
    const previous = (await client.query('SELECT * FROM pdga_catalog.sync_runs ORDER BY completed_at DESC LIMIT 1')).rows[0]
    if (previous && (new Date(snapshot.fetchedAt) < new Date(previous.fetched_at) ||
        courses.length < previous.course_count * .75)) throw new Error('Older or unexpectedly smaller PDGA snapshot; catalogue unchanged.')
    const id = randomUUID()
    await client.query('INSERT INTO pdga_catalog.sync_runs(id,fetched_at,course_count) VALUES($1,$2,$3)',
      [id, snapshot.fetchedAt, courses.length])
    await client.query(`INSERT INTO pdga_catalog.courses
      (id,name,city,latitude,longitude,expected_holes,source_url,sync_id)
      SELECT id,name,city,latitude,longitude,expected_holes,source_url,$2
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,city text,latitude double precision,
        longitude double precision,expected_holes integer,source_url text)
      ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,city=EXCLUDED.city,latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude,expected_holes=EXCLUDED.expected_holes,sync_id=EXCLUDED.sync_id,
        source_url=EXCLUDED.source_url,synced_at=now(),active=true`, [JSON.stringify(courses), id])
    await client.query('UPDATE pdga_catalog.courses SET active=false WHERE sync_id<>$1', [id])
    await client.query('COMMIT')
    return { event: 'pdga_sync_completed', courseCount: courses.length, layoutsAvailable: false }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool()
  let stage = 'approval'
  try {
    if (process.env.PDGA_CACHE_APPROVED !== 'true') throw new Error('PDGA storage terms have not been confirmed.')
    stage = 'fetch'
    const snapshot = await fetchPdgaNorway({ username: process.env.PDGA_USERNAME, password: process.env.PDGA_PASSWORD })
    stage = 'publication'
    console.log(JSON.stringify(await savePdgaCatalogue(pool, snapshot)))
  } catch (error) {
    const code = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'PDGA_SYNC_FAILED'
    console.error(JSON.stringify({ event: 'pdga_sync_failed', stage, code,
      message: 'PDGA sync failed; inspect access, source availability, and database configuration. Sensitive error details suppressed.' }))
    process.exitCode = 1
  } finally { await pool.end() }
}
