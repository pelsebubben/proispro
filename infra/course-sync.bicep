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

var role = stage == 'dev' ? 'griplock_dev_courses_sync' : 'griplock_courses_sync'
var databaseName = stage == 'dev' ? 'griplock_dev' : 'griplock'
var identity = { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
var registry = [{ server: registryServer, identity: pullIdentityId }]
var tags = { application: 'griplock', environment: stage, managedBy: 'bicep', component: 'course-catalogue' }

// Manual bootstrap only. Administrator credentials are never present in the scheduled worker.
resource provision 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-griplock-courses-setup-${stage}'
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
        ]
      }]
    }
  }
}

resource sync 'Microsoft.App/jobs@2024-03-01' = {
  name: 'job-griplock-courses-${stage}'
  location: location
  tags: tags
  identity: identity
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Schedule'
      replicaTimeout: 600
      replicaRetryLimit: 0
      scheduleTriggerConfig: {
        // Weekly UTC, offset between environments. PostgreSQL also prevents overlapping publication.
        cronExpression: stage == 'dev' ? '17 3 * * 0' : '47 3 * * 0'
        parallelism: 1
        replicaCompletionCount: 1
      }
      registries: registry
      secrets: [{ name: 'pg-sync', value: syncPassword }]
    }
    template: {
      containers: [{
        name: 'task'
        image: image
        command: ['node', 'server/sync-courses.mjs']
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'PGHOST', value: databaseHost }
          { name: 'PGDATABASE', value: databaseName }
          { name: 'PGUSER', value: role }
          { name: 'PGPASSWORD', secretRef: 'pg-sync' }
        ]
      }]
    }
  }
}
