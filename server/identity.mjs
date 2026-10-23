export function identityConfiguration(env) {
  const names = ['AUTH_ISSUER', 'AUTH_AUDIENCE', 'AUTH_JWKS_URL', 'AUTH_REQUIRED_SCOPE',
    'ENTRA_CLIENT_ID', 'ENTRA_AUTHORITY', 'ENTRA_API_SCOPE']
  if (names.every(name => !env[name])) return null
  for (const name of names) if (!env[name]) throw new Error(`Incomplete customer identity configuration: ${name}`)
  const authority = new URL(env.ENTRA_AUTHORITY)
  const issuer = new URL(env.AUTH_ISSUER)
  const keys = new URL(env.AUTH_JWKS_URL)
  if ([authority, issuer, keys].some(url => url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)) {
    throw new Error('Customer identity endpoints require HTTPS without credentials, query or fragment')
  }
  if (!authority.hostname.endsWith('.ciamlogin.com') || authority.origin !== issuer.origin || issuer.origin !== keys.origin) {
    throw new Error('Customer identity must use the configured External ID authority')
  }
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
  if (!uuid.test(env.ENTRA_CLIENT_ID) || !uuid.test(env.AUTH_AUDIENCE)) throw new Error('Entra application IDs must be UUIDs')
  if (env.ENTRA_CLIENT_ID === env.AUTH_AUDIENCE) throw new Error('Use separate browser and API app registrations')
  if (!/^[\w.]+$/.test(env.AUTH_REQUIRED_SCOPE) ||
      !env.ENTRA_API_SCOPE.endsWith(`/${env.AUTH_REQUIRED_SCOPE}`) || /\s/.test(env.ENTRA_API_SCOPE)) {
    throw new Error('Request exactly the configured delegated API scope')
  }
  return {
    issuer: issuer.href, audience: env.AUTH_AUDIENCE, jwksUrl: keys.href,
    requiredScope: env.AUTH_REQUIRED_SCOPE,
    browser: { clientId: env.ENTRA_CLIENT_ID, authority: authority.href, scope: env.ENTRA_API_SCOPE },
  }
}

export function runtimeConfiguration(identity, { devAuth = false } = {}) {
  if (devAuth) return { environment: 'local-dev', dataBackend: 'api', identityReady: true, devAuth: true }
  return { environment: 'live', dataBackend: 'api', identityReady: Boolean(identity),
    ...(identity ? { entra: identity.browser } : {}) }
}
