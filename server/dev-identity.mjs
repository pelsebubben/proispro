import { createECDH, createHash, createPrivateKey, createPublicKey, hkdfSync, randomUUID, timingSafeEqual } from 'node:crypto'
import { calculateJwkThumbprint, createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

// Local development/security-testing identity. Tokens are verified by the same
// code path as real customer tokens. Local keys live only in memory; the hosted
// dev key is derived from the passcode so sessions survive restarts and
// scale-to-zero, while rotating the passcode revokes every issued token.
export const DEV_AUTH_FLAG = 'local-only'
export const DEV_ISSUER = 'urn:griplock:local-dev-identity'
export const DEV_AUDIENCE = 'griplock-local-dev-api'
export const DEV_SCOPE = 'access_as_user'
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost'])
const userPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const scopePattern = /^[\w. ]{0,200}$/
const tokenLifetimeSeconds = 12 * 60 * 60

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

// Shared dev login for the hosted dev app only. Anyone holding the passcode can
// sign in as any test user against the dev database; prod can never enable it.
export const HOSTED_DEV_APP = 'app-griplock-dev'

export function hostedDevPasscode(env) {
  const passcode = env.GRIPLOCK_DEV_PASSCODE
  if (passcode === undefined || passcode === '') return null
  if (env.GRIPLOCK_STAGE !== 'dev' || env.CONTAINER_APP_NAME !== HOSTED_DEV_APP) {
    throw new Error(`Dev passcode login is only allowed on ${HOSTED_DEV_APP}`)
  }
  if (devIdentityRequested(env)) throw new Error('Dev passcode login cannot be combined with local dev identity')
  if (passcode.length < 32) throw new Error('Dev passcode must be at least 32 characters')
  return passcode
}

export function isLoopbackAddress(address) {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

const p256Order = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n

// The passcode is a high-entropy secret (at least 32 characters), so HKDF is
// sufficient to turn it into a valid P-256 private scalar.
function passcodeSigningKey(passcode) {
  for (let counter = 0; ; counter++) {
    const d = Buffer.from(hkdfSync('sha256', passcode, 'griplock-dev-identity', `es256-signing-key:${counter}`, 32))
    const scalar = BigInt(`0x${d.toString('hex')}`)
    if (scalar === 0n || scalar >= p256Order) continue
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(d)
    const point = ecdh.getPublicKey()
    const privateKey = createPrivateKey({ format: 'jwk', key: {
      kty: 'EC', crv: 'P-256', d: d.toString('base64url'),
      x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url'),
    } })
    return { privateKey, publicKey: createPublicKey(privateKey) }
  }
}

export async function createDevIdentity({ passcode = null } = {}) {
  const { privateKey, publicKey } = passcode ? passcodeSigningKey(passcode) : await generateKeyPair('ES256')
  const publicJwk = await exportJWK(publicKey)
  const kid = await calculateJwkThumbprint(publicJwk)
  const keys = createLocalJWKSet({ keys: [{ ...publicJwk, kid, alg: 'ES256', use: 'sig' }] })
  const digest = value => createHash('sha256').update(String(value)).digest()
  const expected = passcode ? digest(passcode) : null
  return {
    hosted: Boolean(passcode),
    checkPasscode: value => Boolean(expected) && typeof value === 'string' && timingSafeEqual(digest(value), expected),
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
        .setIssuedAt().setExpirationTime(`${tokenLifetimeSeconds}s`).setJti(randomUUID())
        .sign(privateKey)
      return { access_token: accessToken, token_type: 'Bearer', expires_in: tokenLifetimeSeconds, user }
    },
  }
}
