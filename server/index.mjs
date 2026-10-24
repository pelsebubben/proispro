import { createApplication } from './app.mjs'
import { createPool } from './database.mjs'
import { createPdgaService } from './pdga-service.mjs'
import { identityConfiguration } from './identity.mjs'
import { assertDevIdentityAllowed, createDevIdentity, devIdentityRequested, hostedDevPasscode } from './dev-identity.mjs'

const identity = identityConfiguration(process.env)
let devIdentity = null
let host = '0.0.0.0'
const passcode = hostedDevPasscode(process.env)
if (passcode) {
  if (identity) throw new Error('Dev passcode login cannot be combined with customer identity configuration')
  devIdentity = await createDevIdentity({ passcode })
  console.warn(JSON.stringify({ event: 'dev_passcode_login_enabled',
    warning: 'HOSTED DEV LOGIN: passcode holders can sign in as any test user on the dev database' }))
} else if (devIdentityRequested(process.env)) {
  host = process.env.HOST ?? '127.0.0.1'
  assertDevIdentityAllowed(process.env, { host, customerIdentity: identity })
  devIdentity = await createDevIdentity()
  console.warn(JSON.stringify({ event: 'dev_identity_enabled',
    warning: 'LOCAL DEV IDENTITY: anyone on this machine can sign in as any test user' }))
} else if (!identity) console.warn(JSON.stringify({ event: 'customer_identity_not_configured' }))
const pool = createPool()
const pdga = createPdgaService({ username: process.env.PDGA_USERNAME, password: process.env.PDGA_PASSWORD })
pool.on('error', error => console.error(JSON.stringify({ event: 'database_pool_error', code: error.code })))
const server = createApplication({
  pool, ...(identity ?? {}), identity, devIdentity, pdga, sourceSha: process.env.SOURCE_SHA ?? 'local',
})
server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.listen(Number(process.env.PORT ?? 8080), host, () => {
  console.log(JSON.stringify({ event: 'listening', host, sourceSha: process.env.SOURCE_SHA ?? 'local' }))
})
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    pdga?.close()
    server.close(async () => { await pool.end(); process.exit(0) })
    setTimeout(() => process.exit(1), 10_000).unref()
  })
}
