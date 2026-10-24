import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { featureRequest, publicSale } from './features.mjs'
import { courseRequest } from './courses.mjs'
import { schemaVersion } from './migrate.mjs'
import { runtimeConfiguration } from './identity.mjs'
import { isLoopbackAddress } from './dev-identity.mjs'

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

export function createApplication({ pool, issuer, audience, jwksUrl, requiredScope,
  identity = null, devIdentity = null, staticRoot = 'dist', sourceSha = 'local' }) {
  let jwks
  if (devIdentity) {
    if (!devIdentity.hosted && process.env.NODE_ENV === 'production') throw new Error('Local dev identity is forbidden in production')
    if (identity || jwksUrl) throw new Error('Local dev identity cannot be combined with customer identity')
    ;({ issuer, audience, requiredScope } = devIdentity)
    jwks = devIdentity.keys
  } else if (issuer || audience || jwksUrl) {
    const issuerUrl = new URL(issuer)
    const keysUrl = new URL(jwksUrl)
    if (!audience || keysUrl.origin !== issuerUrl.origin) throw new Error('JWKS, issuer and audience must be configured together')
    if (process.env.NODE_ENV === 'production' && issuerUrl.protocol !== 'https:') {
      throw new Error('Production identity requires HTTPS')
    }
    jwks = createRemoteJWKSet(keysUrl)
  }
  const root = resolve(staticRoot)
  let passcodeFailures = []
  return createServer(async (req, res) => {
    const requestId = randomUUID()
    res.setHeader('X-Request-Id', requestId)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    const json = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(value))
    }
    const image = bytes => {
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' })
      res.end(bytes)
    }
    try {
      const url = new URL(req.url, 'http://localhost')
      const runtime = runtimeConfiguration(identity, { devAuth: Boolean(devIdentity), devPasscode: Boolean(devIdentity?.hosted) })
      if (url.pathname === '/auth/config') return json(200, runtime)
      if (url.pathname === '/runtime-config.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
        return res.end(`window.__GRIPLOCK_RUNTIME__ = ${JSON.stringify(runtime)}`)
      }
      if (url.pathname.startsWith('/dev-auth/')) {
        if (!devIdentity || (!devIdentity.hosted && !isLoopbackAddress(req.socket.remoteAddress))) return json(404, { error: 'not_found' })
        if (url.pathname !== '/dev-auth/token') return json(404, { error: 'not_found' })
        if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })
        if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'json_required' })
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 1024) return json(413, { error: 'body_too_large' })
        }
        let body
        try { body = JSON.parse(raw) } catch { return json(400, { error: 'invalid_json' }) }
        if (devIdentity.hosted) {
          const now = Date.now()
          passcodeFailures = passcodeFailures.filter(time => now - time < 60_000)
          if (passcodeFailures.length >= 20) return json(429, { error: 'too_many_attempts' })
          if (!devIdentity.checkPasscode(body?.passcode)) {
            passcodeFailures.push(now)
            console.warn(JSON.stringify({ event: 'dev_passcode_rejected', requestId }))
            return json(401, { error: 'invalid_passcode' })
          }
        }
        try {
          const issued = await devIdentity.issue({ user: body?.user, ...(body?.scope !== undefined ? { scope: body.scope } : {}) })
          console.warn(JSON.stringify({ event: 'dev_identity_token_issued', requestId, user: issued.user }))
          return json(200, issued)
        } catch (error) {
          if (error instanceof TypeError) return json(400, { error: error.message })
          throw error
        }
      }
      if (url.pathname === '/health/live') return json(200, { status: 'ok', sourceSha })
      if (url.pathname === '/health/ready') {
        const result = await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1')
        if (result.rows[0]?.version !== schemaVersion) return json(503, { status: 'schema_not_ready' })
        return json(200, { status: 'ready', sourceSha, schemaVersion })
      }
      const sale = url.pathname.match(/^\/api\/v1\/public\/sales\/([^/]+)$/)
      if (sale) {
        if (req.method !== 'GET') return json(405, { error: 'method_not_allowed' })
        return await publicSale(pool, sale[1], json)
      }
      if (url.pathname.startsWith('/api/')) {
        const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1]
        if (!token) return json(401, { error: 'unauthorized' })
        if (!jwks) return json(503, { error: 'identity_not_configured' })
        let identity
        try {
          const result = await jwtVerify(token, jwks, { issuer, audience, algorithms: ['RS256', 'ES256'] })
          if (!result.payload.sub) return json(401, { error: 'unauthorized' })
          if (requiredScope && (typeof result.payload.scp !== 'string' ||
              !result.payload.scp.split(' ').includes(requiredScope))) {
            return json(403, { error: 'insufficient_scope' })
          }
          identity = result.payload
        } catch (error) {
          console.warn(JSON.stringify({ event: 'authentication_rejected', requestId, code: error.code ?? 'verification_failed' }))
          return json(401, { error: 'unauthorized' })
        }
        await pool.query(`INSERT INTO app_users (issuer, subject) VALUES ($1, $2)
          ON CONFLICT (issuer, subject) DO NOTHING`, [issuer, identity.sub])
        const users = await pool.query('SELECT id FROM app_users WHERE issuer=$1 AND subject=$2', [issuer, identity.sub])
        const userId = users.rows[0].id
        if (url.pathname === '/api/v1/session' && req.method === 'GET') return json(200, { userId })
        if (url.pathname === '/api/v1/courses' || url.pathname.startsWith('/api/v1/courses/')) {
          return await courseRequest({ req, url, pool, json })
        }
        return await featureRequest({ req, url, pool, userId, json, image })
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'method_not_allowed' })
      const path = resolve(root, `.${decodeURIComponent(url.pathname)}`)
      if (path !== root && !path.startsWith(root + sep)) return json(404, { error: 'not_found' })
      let file = path
      let data
      try { data = await readFile(path) } catch (error) {
        if (!['ENOENT', 'EISDIR'].includes(error.code)) throw error
        if (extname(path)) return json(404, { error: 'not_found' })
        file = resolve(root, 'index.html')
        data = await readFile(file)
      }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': file.includes(`${sep}assets${sep}`) ? 'public,max-age=31536000,immutable' : 'no-cache' })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', requestId, code: error.code ?? error.name }))
      json(503, { error: 'service_unavailable', requestId })
    }
  })
}
