param location string = resourceGroup().location
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

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'app-griplock-staging'
  location: location
  tags: { application: 'griplock', environment: 'staging', managedBy: 'bicep', sourceSha: sourceSha }
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
      secrets: [{ name: 'pg-app', value: postgresAppPassword }]
    }
    template: {
      revisionSuffix: 'r-${take(sourceSha, 12)}-${releaseId}'
      scale: { minReplicas: 1, maxReplicas: 3 }
      containers: [{
        name: 'app'
        image: image
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'NODE_ENV', value: 'production' }
          { name: 'PORT', value: '8080' }
          { name: 'PGHOST', value: databaseHost }
          { name: 'PGDATABASE', value: 'griplock' }
          { name: 'PGUSER', value: 'griplock_app' }
          { name: 'PGPASSWORD', secretRef: 'pg-app' }
          { name: 'SOURCE_SHA', value: sourceSha }
          { name: 'AUTH_ISSUER', value: authIssuer }
          { name: 'AUTH_JWKS_URL', value: authJwksUrl }
          { name: 'AUTH_AUDIENCE', value: authAudience }
          { name: 'AUTH_REQUIRED_SCOPE', value: authRequiredScope }
          { name: 'ENTRA_CLIENT_ID', value: entraClientId }
          { name: 'ENTRA_AUTHORITY', value: entraAuthority }
          { name: 'ENTRA_API_SCOPE', value: entraApiScope }
        ]
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
