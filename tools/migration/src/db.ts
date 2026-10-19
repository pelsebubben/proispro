import * as sql from 'mssql'
import { requireEnv, optionalEnv, envBool } from './env'

// Builds an mssql connection pool for Azure SQL. Two auth modes, both documented
// in README and .env.example:
//
//   SQL_AUTH=aad  -> Entra auth. We fetch a token via @azure/identity's
//                    DefaultAzureCredential (honours `az login`, managed
//                    identity, env-var service principals, etc.) and hand it to
//                    tedious as an access token. Preferred for the one-time run.
//
//   SQL_AUTH=sql  -> plain SQL login with SQL_USER / SQL_PASSWORD. Handy when
//                    AAD is not set up yet.

const SQL_SCOPE = 'https://database.windows.net/.default'

export async function createPool(): Promise<sql.ConnectionPool> {
  const server = requireEnv('SQL_SERVER')
  const database = requireEnv('SQL_DATABASE')
  const authMode = optionalEnv('SQL_AUTH', 'aad').toLowerCase()
  const port = Number(optionalEnv('SQL_PORT', '1433'))
  const encrypt = envBool('SQL_ENCRYPT', true)
  const trustServerCertificate = envBool('SQL_TRUST_SERVER_CERT', false)

  const base: sql.config = {
    server,
    database,
    port,
    options: { encrypt, trustServerCertificate },
    pool: { max: 4, min: 0, idleTimeoutMillis: 30000 },
  }

  let config: sql.config
  if (authMode === 'sql') {
    config = {
      ...base,
      user: requireEnv('SQL_USER'),
      password: requireEnv('SQL_PASSWORD'),
    }
  } else if (authMode === 'aad') {
    // Lazy import so `SQL_AUTH=sql` users need not have a working credential.
    const { DefaultAzureCredential } = await import('@azure/identity')
    const credential = new DefaultAzureCredential()
    const tokenResponse = await credential.getToken(SQL_SCOPE)
    if (!tokenResponse) {
      throw new Error(
        'Failed to acquire an Entra access token for Azure SQL. ' +
          'Run `az login` or configure a managed identity / service principal.'
      )
    }
    config = {
      ...base,
      authentication: {
        type: 'azure-active-directory-access-token',
        options: { token: tokenResponse.token },
      },
    }
  } else {
    throw new Error(`Unknown SQL_AUTH "${authMode}". Use "aad" or "sql".`)
  }

  const pool = new sql.ConnectionPool(config)
  await pool.connect()
  return pool
}
