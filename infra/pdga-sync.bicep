param location string = resourceGroup().location
@allowed(['dev', 'prod'])
param stage string = 'dev'
param environmentId string
param image string
param registryServer string
param pullIdentityId string
param databaseHost string
@secure()
param adminPassword string
@secure()
param syncPassword string
@secure()
param pdgaUsername string
@secure()
param pdgaPassword string
// Leave disabled until the account's agreement permits this server-side cache.
param cacheApproved bool = false

var role = stage == 'dev' ? 'griplock_dev_pdga_sync' : 'griplock_pdga_sync'
var databaseName = stage == 'dev' ? 'griplock_dev' : 'griplock'
var identity = { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
var registry = [{ server: registryServer, identity: pullIdentityId }]
var tags = { application: 'griplock', environment: stage, managedBy: 'bicep', component: 'pdga-catalogue' }

resource provision 'Microsoft.App/jobs@2024-03-01' = if (cacheApproved) {
  name: 'job-griplock-pdga-setup-${stage}'
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 180
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: registry
      secrets: [{ name: 'pg-admin', value: adminPassword }, { name: 'pg-sync', value: syncPassword }]
    }
    template: {
      containers: [{
        name: 'task'
        image: image
        command: ['node', 'server/provision-course-sync.mjs']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PGHOST', value: databaseHost }
          { name: 'PGDATABASE', value: databaseName }
          { name: 'PGUSER', value: 'griplock_admin' }
          { name: 'PGPASSWORD', secretRef: 'pg-admin' }
          { name: 'PGCOURSE_USER', value: role }
          { name: 'PGCOURSE_PASSWORD', secretRef: 'pg-sync' }
          { name: 'PGCOURSE_PROVIDER', value: 'pdga' }
        ]
      }]
    }
  }
}

// Manual until PDGA's permitted refresh interval is confirmed; no credentials reach the app.
resource sync 'Microsoft.App/jobs@2024-03-01' = if (cacheApproved) {
  name: 'job-griplock-pdga-${stage}'
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 900
      replicaRetryLimit: 0
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      registries: registry
      secrets: [
        { name: 'pg-sync', value: syncPassword }
        { name: 'pdga-username', value: pdgaUsername }
        { name: 'pdga-password', value: pdgaPassword }
      ]
    }
    template: {
      containers: [{
        name: 'task'
        image: image
        command: ['node', 'server/sync-pdga.mjs']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PGHOST', value: databaseHost }
          { name: 'PGDATABASE', value: databaseName }
          { name: 'PGUSER', value: role }
          { name: 'PGPASSWORD', secretRef: 'pg-sync' }
          { name: 'PDGA_USERNAME', secretRef: 'pdga-username' }
          { name: 'PDGA_PASSWORD', secretRef: 'pdga-password' }
          { name: 'PDGA_CACHE_APPROVED', value: 'true' }
        ]
      }]
    }
  }
}
