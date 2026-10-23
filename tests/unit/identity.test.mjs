import assert from 'node:assert/strict'
import test from 'node:test'
import { identityConfiguration, runtimeConfiguration } from '../../server/identity.mjs'

const config = {
  AUTH_ISSUER: 'https://fixture.ciamlogin.com/tenant/v2.0',
  AUTH_AUDIENCE: '22222222-2222-4222-8222-222222222222',
  AUTH_JWKS_URL: 'https://fixture.ciamlogin.com/tenant/discovery/v2.0/keys',
  AUTH_REQUIRED_SCOPE: 'access_as_user',
  ENTRA_CLIENT_ID: '11111111-1111-4111-8111-111111111111',
  ENTRA_AUTHORITY: 'https://fixture.ciamlogin.com/tenant',
  ENTRA_API_SCOPE: 'api://22222222-2222-4222-8222-222222222222/access_as_user',
}

test('customer identity is explicitly disabled or completely configured, never Supabase fallback', () => {
  assert.equal(identityConfiguration({}), null)
  assert.deepEqual(runtimeConfiguration(null), { environment: 'live', dataBackend: 'api', identityReady: false })
  for (const name of Object.keys(config)) {
    assert.throws(() => identityConfiguration({ ...config, [name]: '' }), /Incomplete/)
  }
  const identity = identityConfiguration({ ...config, SOMETHING_SECRET: 'do-not-expose' })
  assert.equal(identity.requiredScope, 'access_as_user')
  assert.deepEqual(runtimeConfiguration(identity), {
    environment: 'live', dataBackend: 'api', identityReady: true,
    entra: { clientId: config.ENTRA_CLIENT_ID, authority: config.ENTRA_AUTHORITY, scope: config.ENTRA_API_SCOPE },
  })
  assert.ok(!JSON.stringify(runtimeConfiguration(identity)).includes('do-not-expose'))
})

test('reject wrong tenants, insecure endpoints, ID-token audiences and ambiguous API scopes', () => {
  for (const override of [
    { AUTH_ISSUER: 'http://fixture.ciamlogin.com/tenant/v2.0' },
    { ENTRA_AUTHORITY: 'https://login.microsoftonline.com/common' },
    { AUTH_JWKS_URL: 'https://another.ciamlogin.com/keys' },
    { ENTRA_CLIENT_ID: config.AUTH_AUDIENCE },
    { ENTRA_CLIENT_ID: 'not-a-uuid' },
    { AUTH_AUDIENCE: 'authenticated' },
    { ENTRA_API_SCOPE: 'openid email' },
    { ENTRA_API_SCOPE: 'api://example/other' },
    { AUTH_REQUIRED_SCOPE: 'access_as_user other' },
    { AUTH_JWKS_URL: 'https://fixture.ciamlogin.com/keys?client_secret=not-valid' },
  ]) assert.throws(() => identityConfiguration({ ...config, ...override }), JSON.stringify(override))
})
