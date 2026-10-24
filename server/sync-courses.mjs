import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createPool } from './database.mjs'
import { fetchNorwaySnapshot, normalizeNorway } from './osm-catalog.mjs'

export async function saveCatalogue(pool, snapshot) {
  const { timestamp, courses, holes, report } = normalizeNorway(snapshot)
  if (courses.length < 10) throw new Error('Norway snapshot has fewer than 10 named courses; refusing replacement')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SET LOCAL statement_timeout='60s'")
    const lock = await client.query('SELECT pg_try_advisory_xact_lock(72491923) AS locked')
    if (!lock.rows[0].locked) throw new Error('Another course sync is already running')
    const previous = (await client.query(`SELECT source_timestamp, report FROM course_catalog.sync_runs
      WHERE country='NO' ORDER BY completed_at DESC LIMIT 1`)).rows[0]
    if (previous && new Date(timestamp) < new Date(previous.source_timestamp)) throw new Error('Refusing older OSM snapshot')
    if (previous && (courses.length < previous.report.importedCourses * .75 ||
        (previous.report.importedHoles > 0 && holes.length < previous.report.importedHoles * .75))) {
      throw new Error('Catalogue shrank by more than 25%; review source coverage before replacing')
    }
    const syncId = randomUUID()
    await client.query(`INSERT INTO course_catalog.sync_runs(id,country,source_timestamp,report)
      VALUES ($1,'NO',$2,$3)`, [syncId, timestamp, JSON.stringify(report)])
    // One transaction publishes a complete snapshot. Removed objects are retained as inactive.
    await client.query(`INSERT INTO course_catalog.courses
      (id,country,name,city,latitude,longitude,expected_holes,source_version,source_updated_at,sync_id)
      SELECT id,'NO',name,city,latitude,longitude,expected_holes,source_version,source_updated_at,$2
      FROM jsonb_to_recordset($1::jsonb) AS x(id text,name text,city text,latitude double precision,
        longitude double precision,expected_holes integer,source_version integer,source_updated_at timestamptz)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,city=EXCLUDED.city,latitude=EXCLUDED.latitude,
        longitude=EXCLUDED.longitude,expected_holes=EXCLUDED.expected_holes,source_version=EXCLUDED.source_version,
        source_updated_at=EXCLUDED.source_updated_at,sync_id=EXCLUDED.sync_id,synced_at=now(),active=true`,
    [JSON.stringify(courses), syncId])
    await client.query("UPDATE course_catalog.courses SET active=false WHERE country='NO' AND sync_id<>$1", [syncId])
    await client.query('DELETE FROM course_catalog.holes')
    await client.query(`INSERT INTO course_catalog.holes
      (course_id,id,ref,name,par,length_m,geometry,association,source_version,source_updated_at,sync_id)
      SELECT course_id,id,ref,name,par,length_m,geometry,association,source_version,source_updated_at,$2
      FROM jsonb_to_recordset($1::jsonb) AS x(course_id text,id text,ref text,name text,par integer,
        length_m double precision,geometry jsonb,association text,source_version integer,source_updated_at timestamptz)`,
    [JSON.stringify(holes), syncId])
    await client.query('COMMIT')
    return { syncId, timestamp, ...report }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool()
  try {
    const result = await saveCatalogue(pool, await fetchNorwaySnapshot())
    console.log(JSON.stringify({ event: 'course_sync_completed', ...result }))
  } catch (error) {
    console.error(JSON.stringify({ event: 'course_sync_failed', message: error.message }))
    process.exitCode = 1
  } finally { await pool.end() }
}
