import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { createPool } from './database.mjs'

export const schemaVersion = 7

export async function migrate(pool, appPassword, appRole = 'griplock_app') {
  if (!appPassword || appPassword.length < 32) throw new Error('PGAPP_PASSWORD must contain at least 32 characters')
  if (!/^griplock_[a-z0-9_]{1,40}$/.test(appRole) || appRole === 'griplock_admin') throw new Error('Invalid runtime role name')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(72491922)")
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`)
    for (const [index, file] of ['001_initial.sql', '002_features.sql', '003_disc_photos.sql', '004_course_catalog.sql', '005_pdga_catalog.sql', '006_private_planner.sql', '007_pdga_cache.sql'].entries()) {
      const sql = await readFile(new URL(`./migrations/${file}`, import.meta.url), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const version = index + 1
      const existing = await client.query('SELECT checksum FROM schema_migrations WHERE version = $1', [version])
      if (existing.rowCount && existing.rows[0].checksum !== checksum) throw new Error('Applied migration checksum differs')
      if (!existing.rowCount) {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [version, checksum])
      }
    }
    // Password and role are bound as data and quoted by PostgreSQL, never interpolated into SQL.
    await client.query("SELECT set_config('app.runtime_password', $1, true)", [appPassword])
    await client.query("SELECT set_config('app.runtime_role', $1, true)", [appRole])
    await client.query(`DO $migration$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_setting('app.runtime_role')) THEN
          EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
            current_setting('app.runtime_role'));
        END IF;
        EXECUTE format('ALTER ROLE %I PASSWORD %L', current_setting('app.runtime_role'), current_setting('app.runtime_password'));
      END $migration$`)
    // Role name is validated above to a strict identifier pattern.
    await client.query(`GRANT USAGE ON SCHEMA public TO ${appRole}`)
    await client.query(`GRANT SELECT, INSERT ON app_users TO ${appRole}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON owned_discs TO ${appRole}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON bags, bag_history, collections,
      collection_discs, wishlist_items, forsale_listings, sale_tokens, course_pins, hole_assignments,
      disc_photos TO ${appRole}`)
    await client.query(`GRANT SELECT ON schema_migrations TO ${appRole}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON private_layouts,private_plans TO ${appRole}`)
    await client.query(`GRANT USAGE ON SCHEMA provider_cache TO ${appRole}`)
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON provider_cache.entries TO ${appRole}`)
    await client.query(`GRANT SELECT, UPDATE ON provider_cache.control TO ${appRole}`)
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
    await migrate(pool, process.env.PGAPP_PASSWORD, process.env.PGAPP_USER ?? 'griplock_app')
    console.log(JSON.stringify({ event: 'migration_completed', version: schemaVersion }))
  } finally {
    await pool.end()
  }
}
