param location string = resourceGroup().location
@allowed(['live', 'dev'])
param stage string = 'live'
param environmentId string
param databaseHost string
param image string
param registryServer string
param pullIdentityId string
param sourceSha string
param releaseId string
param entraClientId string = ''
param entraAuthority string = ''
param entraApiScope string = ''
param authIssuer string = ''
param authAudience string = ''
param authJwksUrl string = ''
param authRequiredScope string = ''
@secure()
param postgresAppPassword string
@secure()
param devLoginPasscode string = ''

var live = stage == 'live'
// Shared passcode login exists only on the dev app and replaces customer sign-in there.
var devLogin = !live && !empty(devLoginPasscode)
var devLoginEnv = devLogin ? [
  { name: 'GRIPLOCK_STAGE', value: 'dev' }
  { name: 'GRIPLOCK_DEV_PASSCODE', secretRef: 'dev-passcode' }
] : []

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: live ? 'app-griplock-staging' : 'app-griplock-dev'
  location: location
  tags: { application: 'griplock', environment: live ? 'staging' : 'dev', managedBy: 'bicep', sourceSha: sourceSha }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [{ server: registryServer, identity: pullIdentityId }]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'http'
        allowInsecure: false
      }
      secrets: concat([{ name: 'pg-app', value: postgresAppPassword }], devLogin ? [{ name: 'dev-passcode', value: devLoginPasscode }] : [])
    }
    template: {
      revisionSuffix: 'r-${take(sourceSha, 12)}-${releaseId}'
      scale: { minReplicas: live ? 1 : 0, maxReplicas: live ? 3 : 1 }
      containers: [{
        name: 'app'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: concat([
          { name: 'NODE_ENV', value: 'production' }
          { name: 'PORT', value: '8080' }
          { name: 'PGHOST', value: databaseHost }
          { name: 'PGDATABASE', value: live ? 'griplock' : 'griplock_dev' }
          { name: 'PGUSER', value: live ? 'griplock_app' : 'griplock_dev_app' }
          { name: 'PGPASSWORD', secretRef: 'pg-app' }
          { name: 'SOURCE_SHA', value: sourceSha }
          { name: 'AUTH_ISSUER', value: devLogin ? '' : authIssuer }
          { name: 'AUTH_JWKS_URL', value: devLogin ? '' : authJwksUrl }
          { name: 'AUTH_AUDIENCE', value: devLogin ? '' : authAudience }
          { name: 'AUTH_REQUIRED_SCOPE', value: devLogin ? '' : authRequiredScope }
          { name: 'ENTRA_CLIENT_ID', value: devLogin ? '' : entraClientId }
          { name: 'ENTRA_AUTHORITY', value: devLogin ? '' : entraAuthority }
          { name: 'ENTRA_API_SCOPE', value: devLogin ? '' : entraApiScope }
        ], devLoginEnv)
        probes: [
          { type: 'Liveness', httpGet: { path: '/health/live', port: 8080 }, initialDelaySeconds: 10, periodSeconds: 10 }
          { type: 'Readiness', httpGet: { path: '/health/ready', port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10 }
          { type: 'Startup', httpGet: { path: '/health/live', port: 8080 }, periodSeconds: 5, failureThreshold: 30 }
        ]
      }]
    }
  }
}
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
