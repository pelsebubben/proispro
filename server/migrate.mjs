import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createPool } from './database.mjs'

export async function migrate(pool, appPassword) {
  if (!appPassword || appPassword.length < 32) throw new Error('PGAPP_PASSWORD must contain at least 32 characters')
  const sql = await readFile(new URL('./migrations/001_initial.sql', import.meta.url), 'utf8')
  const checksum = createHash('sha256').update(sql).digest('hex')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(72491922)")
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
    const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version = 1')
    if (existing.rowCount && existing.rows[0].checksum !== checksum) throw new Error('Applied migration checksum differs')
    if (!existing.rowCount) {
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (version, checksum) VALUES (1, $1)', [checksum])
    }
    // Password is bound as data and quoted by PostgreSQL, never interpolated into SQL.
    await client.query("SELECT set_config('app.runtime_password', $1, true)", [appPassword])
    await client.query(`DO $migration$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'griplock_app') THEN
          CREATE ROLE griplock_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        EXECUTE format('ALTER ROLE griplock_app PASSWORD %L', current_setting('app.runtime_password'));
      END $migration$`)
    await client.query('GRANT USAGE ON SCHEMA public TO griplock_app')
    await client.query('GRANT SELECT, INSERT ON app_users TO griplock_app')
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON owned_discs TO griplock_app')
    await client.query('GRANT SELECT ON schema_migrations TO griplock_app')
    await client.query('COMMIT')
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
    await migrate(pool, process.env.PGAPP_PASSWORD)
    console.log(JSON.stringify({ event: 'migration_completed', version: 1 }))
  } finally {
    await pool.end()
  }
}
