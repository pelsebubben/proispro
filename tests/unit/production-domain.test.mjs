import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('production deployments retain the adopted HTTPS domain without adding it to dev or changing identity', async () => {
  const app = await readFile(new URL('../../infra/app.bicep', import.meta.url), 'utf8')
  assert.match(app, /var live = stage == 'live'/)
  assert.match(app, /var productionCertificateId = '\$\{environmentId\}\/managedCertificates\/griplock\.no-cae-grip-261024191340'/)
  assert.match(app, /customDomains: live \? \[\s*\{\s*name: 'griplock\.no'\s*bindingType: 'SniEnabled'\s*certificateId: productionCertificateId\s*\}\s*\] : \[\]/)
  assert.match(app, /allowInsecure: false/)
  assert.match(app, /name: 'AUTH_AUDIENCE', value: devLogin \? '' : authAudience/)
  assert.match(app, /name: 'ENTRA_API_SCOPE', value: devLogin \? '' : entraApiScope/)
  assert.match(app, /name: 'AUTH_ISSUER', value: devLogin \? '' : authIssuer/)
  const browser = await readFile(new URL('../../src/lib/entra.ts', import.meta.url), 'utf8')
  assert.match(browser, /redirectUri: window\.location\.origin/)
  assert.match(browser, /postLogoutRedirectUri: window\.location\.origin/)
})
