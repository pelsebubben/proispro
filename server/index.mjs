import { createApplication } from './app.mjs'
import { createPool } from './database.mjs'

for (const name of ['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URL']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`)
}
const pool = createPool()
pool.on('error', error => console.error(JSON.stringify({ event: 'database_pool_error', code: error.code })))
const server = createApplication({
  pool, issuer: process.env.AUTH_ISSUER, audience: process.env.AUTH_AUDIENCE,
  jwksUrl: process.env.AUTH_JWKS_URL, sourceSha: process.env.SOURCE_SHA ?? 'local',
})
server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'listening', sourceSha: process.env.SOURCE_SHA ?? 'local' }))
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => { await pool.end(); process.exit(0) })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
