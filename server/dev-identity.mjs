import { randomUUID } from 'node:crypto'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

// Local development/security-testing identity. Tokens are signed by an
// in-memory key and verified by the same code path as real customer tokens.
export const DEV_AUTH_FLAG = 'local-only'
export const DEV_ISSUER = 'urn:griplock:local-dev-identity'
export const DEV_AUDIENCE = 'griplock-local-dev-api'
export const DEV_SCOPE = 'access_as_user'
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])
const userPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const scopePattern = /^[\w. ]{0,200}$/

export function devIdentityRequested(env) {
  return env.GRIPLOCK_DEV_AUTH !== undefined && env.GRIPLOCK_DEV_AUTH !== ''
}

export function assertDevIdentityAllowed(env, { host, customerIdentity }) {
  if (env.GRIPLOCK_DEV_AUTH !== DEV_AUTH_FLAG) throw new Error(`GRIPLOCK_DEV_AUTH must be exactly "${DEV_AUTH_FLAG}"`)
  if (env.NODE_ENV === 'production') throw new Error('Local dev identity is forbidden when NODE_ENV=production')
  if (env.CONTAINER_APP_NAME || env.CONTAINER_APP_ENV_DNS_SUFFIX || env.WEBSITE_SITE_NAME || env.KUBERNETES_SERVICE_HOST) {
    throw new Error('Local dev identity is forbidden on hosted platforms')
  }
  if (customerIdentity) throw new Error('Local dev identity cannot be combined with customer identity configuration')
  if (!loopbackHosts.has(host)) throw new Error('Local dev identity requires a loopback listen address')
}

export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

export async function createDevIdentity() {
  const { privateKey, publicKey } = await generateKeyPair('ES256')
  const kid = randomUUID()
  const keys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid, alg: 'ES256', use: 'sig' }] })
  return {
    issuer: DEV_ISSUER,
    audience: DEV_AUDIENCE,
    requiredScope: DEV_SCOPE,
    keys,
    async issue({ user, scope = DEV_SCOPE }) {
      if (typeof user !== 'string' || !userPattern.test(user)) throw new TypeError('invalid_user')
      if (typeof scope !== 'string' || !scopePattern.test(scope)) throw new TypeError('invalid_scope')
      const accessToken = await new SignJWT({ scp: scope, preferred_username: `${user}@dev.griplock.local` })
        .setProtectedHeader({ alg: 'ES256', kid, typ: 'JWT' })
        .setIssuer(DEV_ISSUER).setAudience(DEV_AUDIENCE).setSubject(`dev:${user}`)
        .setIssuedAt().setExpirationTime('1h').setJti(randomUUID())
        .sign(privateKey)
      return { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, user }
    },
  }
}
