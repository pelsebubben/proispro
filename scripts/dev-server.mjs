// Local development server with the local-only test identity.
// Migrates with the admin login, then serves as the non-superuser runtime role
// so row-level security behaves exactly as in the deployed app.
import { createPool } from '../server/database.mjs'
import { migrate } from '../server/migrate.mjs'

process.env.GRIPLOCK_DEV_AUTH ??= 'local-only'
process.env.NODE_ENV ??= 'development'
process.env.HOST ??= '127.0.0.1'
process.env.PGHOST ??= '127.0.0.1'
process.env.PGDATABASE ??= 'griplock'
process.env.PGUSER ??= 'postgres'
process.env.PGSSLMODE ??= 'disable'
if (!process.env.PGPASSWORD) throw new Error('Set PGPASSWORD to the local PostgreSQL admin password')
if (!process.env.PGAPP_PASSWORD) throw new Error('Set PGAPP_PASSWORD (32+ characters) for the local griplock_app role')

const admin = createPool()
try {
  await migrate(admin, process.env.PGAPP_PASSWORD)
} finally {
  await admin.end()
}
process.env.PGUSER = 'griplock_app'
process.env.PGPASSWORD = process.env.PGAPP_PASSWORD
await import('../server/index.mjs')
