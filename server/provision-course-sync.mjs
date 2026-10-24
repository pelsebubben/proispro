import { pathToFileURL } from 'node:url'
import { createPool } from './database.mjs'

export async function provisionCourseSync(pool, password, role, provider = 'osm') {
  const roles = { osm: /^griplock_(?:(?:dev|verify)_)?courses_sync$/, pdga: /^griplock_(?:(?:dev|verify)_)?pdga_sync$/ }
  if (!Object.hasOwn(roles, provider) || !roles[provider].test(role ?? '') || typeof password !== 'string' || password.length < 32) {
    throw new Error('A dedicated course-sync role and 32+ character password are required')
  }
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(72491922)")
    await client.query("SELECT set_config('app.sync_role',$1,true), set_config('app.sync_password',$2,true)", [role, password])
    await client.query(`DO $provision$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname=current_setting('app.sync_role')) THEN
        EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
          current_setting('app.sync_role'));
      END IF;
    END $provision$`)
    const unsafe = await client.query(`SELECT
      r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolinherit
      OR EXISTS (SELECT FROM pg_auth_members WHERE member=r.oid)
      OR EXISTS (SELECT FROM pg_namespace WHERE nspowner=r.oid)
      OR EXISTS (SELECT FROM pg_database WHERE datdba=r.oid)
      OR has_schema_privilege(r.oid,'public','CREATE')
      OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
        AND has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
      AS unsafe FROM pg_roles r WHERE rolname=$1`, [role])
    if (unsafe.rows[0]?.unsafe !== false) throw new Error('Existing course-sync role has unexpected privileges; administrator review required')
    const otherSchema = provider === 'pdga' ? 'course_catalog' : 'pdga_catalog'
    const crossSource = await client.query(`SELECT EXISTS (
      SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=$2 AND c.relkind IN ('r','p','v','m','f')
      AND has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
    ) AS unsafe`, [role, otherSchema])
    if (crossSource.rows[0]?.unsafe !== false) throw new Error('Existing course-sync role has unexpected cross-source privileges; administrator review required')
    await client.query(`DO $password$ BEGIN
      EXECUTE format('ALTER ROLE %I PASSWORD %L',current_setting('app.sync_role'),current_setting('app.sync_password'));
    END $password$`)
    const schema = provider === 'pdga' ? 'pdga_catalog' : 'course_catalog'
    await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`)
    await client.query(`GRANT SELECT, INSERT ON ${schema}.sync_runs TO ${role}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE ON ${schema}.courses TO ${role}`)
    if (provider === 'osm') await client.query(`GRANT SELECT, INSERT, DELETE ON course_catalog.holes TO ${role}`)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = createPool()
  try {
    await provisionCourseSync(pool, process.env.PGCOURSE_PASSWORD, process.env.PGCOURSE_USER, process.env.PGCOURSE_PROVIDER ?? 'osm')
    console.log(JSON.stringify({ event: 'course_sync_role_provisioned' }))
  } finally { await pool.end() }
}
