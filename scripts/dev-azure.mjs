import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'vite'

export const DEV_API = 'https://app-griplock-dev.delightfulisland-939e03e4.swedencentral.azurecontainerapps.io'

export async function startAzureDev({ fetchImpl = fetch, createViteServer = createServer } = {}) {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    throw new Error('Azure dev requires TLS certificate verification')
  }
  const [config, ready] = await Promise.all(['/auth/config', '/health/ready'].map(async path => {
    const response = await fetchImpl(`${DEV_API}${path}`, {
      redirect: 'error', signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok) throw new Error(`Azure dev ${path} returned HTTP ${response.status}`)
    return response.json()
  }))
  if (config?.environment !== 'dev' || config.devAuth !== true || config.devPasscode !== true) {
    throw new Error('Azure dev must advertise the dev environment and passcode-protected login')
  }
  if (ready?.status !== 'ready') throw new Error('Azure dev database is not ready')

  const server = await createViteServer({
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: Object.fromEntries(['/api', '/auth', '/dev-auth', '/runtime-config.js']
        .map(path => [path, { target: DEV_API, changeOrigin: true, secure: true }])),
    },
  })
  try {
    await server.listen()
  } catch (error) {
    await server.close()
    throw error
  }
  console.log('Local UI -> Azure SHARED DEV API -> griplock_dev (not production).')
  console.log('Sign in in the browser with a dedicated test username and the dev passcode.')
  console.log('UI saves affect shared dev data. Do not run API/integration tests against it.')
  server.printUrls()
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startAzureDev().catch(error => {
    console.error(`Azure dev startup failed: ${error.message}`)
    process.exitCode = 1
  })
}
