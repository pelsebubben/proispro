// Azure SQL connection pool.
//
// Two auth modes, selected by environment:
//
//  1. Production (Azure): Managed Identity. We ask @azure/identity's
//     DefaultAzureCredential for an access token scoped to Azure SQL and hand it
//     to the tedious driver. No password ever exists. AZURE_CLIENT_ID (set by the
//     ACA module) selects the user-assigned identity.
//
//  2. Local dev: a SQL login. Set SQL_USER + SQL_PASSWORD (or SQL_CONNECTION_STRING)
//     against a local/Dev SQL Server or Azure SQL. Chosen when SQL_PASSWORD is set.
//
// Trade-off named: MI access tokens expire (~1h). We cache the pool together with
// the token's expiry and transparently rebuild the pool shortly before expiry.
// That's a small reconnect blip under load, which is acceptable for a tens-of-users
// friends app and far simpler than a token-refreshing connection interceptor.
//
// Security boundary: callers MUST use parameterized inputs (request.input(...)).
// No query in this codebase concatenates ownerId or any value into SQL text.

import sql from 'mssql'
import { DefaultAzureCredential } from '@azure/identity'

const AZURE_SQL_SCOPE = 'https://database.windows.net/.default'
// Rebuild the pool this many ms before the token actually expires.
const TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

let poolPromise: Promise<sql.ConnectionPool> | null = null
let tokenExpiresAt = 0

function usePassword(): boolean {
  return Boolean(process.env.SQL_PASSWORD || process.env.SQL_CONNECTION_STRING)
}

function baseOptions(): sql.config['options'] {
  return {
    encrypt: true,
    // trustServerCertificate is only honored for local dev servers with
    // self-signed certs. Azure SQL presents a valid cert, so this is a no-op there.
    trustServerCertificate: process.env.SQL_TRUST_SERVER_CERT === 'true',
  }
}

async function createPool(): Promise<sql.ConnectionPool> {
  const server = process.env.SQL_SERVER
  const database = process.env.SQL_DATABASE
  if (!server || !database) {
    throw new Error('SQL_SERVER and SQL_DATABASE must be set.')
  }

  if (usePassword()) {
    // Local dev: connection string wins if provided, else user/password.
    if (process.env.SQL_CONNECTION_STRING) {
      const pool = new sql.ConnectionPool(process.env.SQL_CONNECTION_STRING)
      return pool.connect()
    }
    const config: sql.config = {
      server,
      database,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      port: process.env.SQL_PORT ? Number(process.env.SQL_PORT) : 1433,
      options: baseOptions(),
    }
    // Password tokens don't expire — park the refresh far in the future.
    tokenExpiresAt = Number.MAX_SAFE_INTEGER
    const pool = new sql.ConnectionPool(config)
    return pool.connect()
  }

  // Production: Managed Identity access token.
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID,
  })
  const accessToken = await credential.getToken(AZURE_SQL_SCOPE)
  if (!accessToken) {
    throw new Error('Failed to acquire an Azure SQL access token via Managed Identity.')
  }
  tokenExpiresAt = accessToken.expiresOnTimestamp

  const config: sql.config = {
    server,
    database,
    options: baseOptions(),
    authentication: {
      type: 'azure-active-directory-access-token',
      options: {
        token: accessToken.token,
      },
    },
  }
  const pool = new sql.ConnectionPool(config)
  return pool.connect()
}

/**
 * Returns a connected pool, rebuilding it if the cached MI token is near expiry.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (poolPromise && Date.now() < tokenExpiresAt - TOKEN_REFRESH_SKEW_MS) {
    return poolPromise
  }

  // Token near expiry (or no pool yet) — tear down and rebuild.
  if (poolPromise) {
    const stale = poolPromise
    poolPromise = null
    stale
      .then((p) => p.close())
      .catch(() => {
        /* best-effort close of the stale pool */
      })
  }

  poolPromise = createPool().catch((err) => {
    // Don't cache a failed connection attempt.
    poolPromise = null
    throw err
  })
  return poolPromise
}

/** Lightweight connectivity probe for /health. */
export async function pingDb(): Promise<boolean> {
  const pool = await getPool()
  await pool.request().query('SELECT 1 AS ok')
  return true
}

export { sql }
