param location string
param environmentId string
param name string
param image string
param registryServer string
param pullIdentityId string
param command array
param databaseHost string
param databaseName string
param appUser string = 'griplock_app'
@secure()
param adminPassword string
@secure()
param appPassword string

resource job 'Microsoft.App/jobs@2024-03-01' = {
  name: name
  location: location
  tags: { application: 'griplock', environment: 'staging', managedBy: 'bicep' }
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${pullIdentityId}': {} } }
  properties: {
    environmentId: environmentId
    workloadProfileName: 'Consumption'
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 600
      replicaRetryLimit: 0
      registries: [{ server: registryServer, identity: pullIdentityId }]
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      secrets: [
        { name: 'pg-admin', value: adminPassword }
        { name: 'pg-app', value: appPassword }
      ]
    }
    template: {
      containers: [{
        name: 'task'
        image: image
        command: command
        resources: { cpu: json('0.5'), memory: '1Gi' }
        env: [
          { name: 'NODE_ENV', value: 'test' }
          { name: 'PGHOST', value: databaseHost }
          { name: 'PGDATABASE', value: databaseName }
          { name: 'PGUSER', value: 'griplock_admin' }
          { name: 'PGPASSWORD', secretRef: 'pg-admin' }
          { name: 'PGAPP_PASSWORD', secretRef: 'pg-app' }
          { name: 'PGAPP_USER', value: appUser }
        ]
      }]
    }
  }
}
