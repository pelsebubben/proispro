import { createApplication } from './app.mjs'
import { createPool } from './database.mjs'
import { identityConfiguration } from './identity.mjs'
import { assertDevIdentityAllowed, createDevIdentity, devIdentityRequested } from './dev-identity.mjs'

const identity = identityConfiguration(process.env)
let devIdentity = null
let host = '0.0.0.0'
if (devIdentityRequested(process.env)) {
  host = process.env.HOST ?? '127.0.0.1'
  assertDevIdentityAllowed(process.env, { host, customerIdentity: identity })
  devIdentity = await createDevIdentity()
  console.warn(JSON.stringify({ event: 'dev_identity_enabled',
    warning: 'LOCAL DEV IDENTITY: anyone on this machine can sign in as any test user' }))
} else if (!identity) console.warn(JSON.stringify({ event: 'customer_identity_not_configured' }))
const pool = createPool()
pool.on('error', error => console.error(JSON.stringify({ event: 'database_pool_error', code: error.code })))
const server = createApplication({
  pool, ...(identity ?? {}), identity, devIdentity, sourceSha: process.env.SOURCE_SHA ?? 'local',
})
server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.listen(Number(process.env.PORT ?? 8080), host, () => {
  console.log(JSON.stringify({ event: 'listening', host, sourceSha: process.env.SOURCE_SHA ?? 'local' }))
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(async () => { await pool.end(); process.exit(0) })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
