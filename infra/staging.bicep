targetScope = 'resourceGroup'

param location string = resourceGroup().location
@secure()
param postgresAdminPassword string
@secure()
param postgresAppPassword string
@secure()
param postgresDevAppPassword string
param image string
param registryServer string
param pullIdentityId string

var suffix = uniqueString(subscription().id, resourceGroup().id)
var tags = { application: 'griplock', environment: 'staging', managedBy: 'bicep' }
var dbName = 'pg-griplock-${suffix}'

resource network 'Microsoft.Network/virtualNetworks@2024-05-01' = {
  name: 'vnet-griplock-staging'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.82.0.0/16'] }
    subnets: [
      {
        name: 'apps'
        properties: {
          addressPrefix: '10.82.0.0/23'
          delegations: [{ name: 'container-apps', properties: { serviceName: 'Microsoft.App/environments' } }]
        }
      }
      {
        name: 'postgres'
        properties: {
          addressPrefix: '10.82.2.0/27'
          delegations: [{ name: 'postgres', properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' } }]
        }
      }
    ]
  }
}

resource dns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'griplock.postgres.database.azure.com'
  location: 'global'
  tags: tags
}
resource dnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: dns
  name: 'staging'
  location: 'global'
  properties: { registrationEnabled: false, virtualNetwork: { id: network.id } }
}
resource database 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: dbName
  location: location
  tags: tags
  sku: { name: 'Standard_D2ads_v5', tier: 'GeneralPurpose' }
  properties: {
    version: '16'
    administratorLogin: 'griplock_admin'
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: '${network.id}/subnets/postgres'
      privateDnsZoneArmResourceId: dns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [dnsLink]
}
resource appDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: database
  name: 'griplock'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource testDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: database
  name: 'griplock_verify'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource devDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: database
  name: 'griplock_dev'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}
resource objects 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stgrip${suffix}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: 'Disabled'
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-griplock-staging'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30, workspaceCapping: { dailyQuotaGb: 1 } }
}
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-griplock-staging'
  location: location
  tags: tags
  properties: {
    vnetConfiguration: { infrastructureSubnetId: '${network.id}/subnets/apps', internal: false }
    workloadProfiles: [{ name: 'Consumption', workloadProfileType: 'Consumption' }]
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

module migration './job.bicep' = {
  name: 'migration-job'
  params: {
    location: location
    environmentId: environment.id
    name: 'job-griplock-migrate'
    image: image
    registryServer: registryServer
    pullIdentityId: pullIdentityId
    command: ['node', 'server/migrate.mjs']
    databaseHost: database.properties.fullyQualifiedDomainName
    databaseName: appDatabase.name
    adminPassword: postgresAdminPassword
    appPassword: postgresAppPassword
  }
}
module verify './job.bicep' = {
  name: 'verification-job'
  params: {
    location: location
    environmentId: environment.id
    name: 'job-griplock-verify'
    image: image
    registryServer: registryServer
    pullIdentityId: pullIdentityId
    command: ['node', '--test', 'tests/api/discs.test.mjs', 'tests/api/courses.test.mjs']
    databaseHost: database.properties.fullyQualifiedDomainName
    databaseName: testDatabase.name
    adminPassword: postgresAdminPassword
    appPassword: postgresAppPassword
  }
}
module devMigration './job.bicep' = {
  name: 'dev-migration-job'
  params: {
    location: location
    environmentId: environment.id
    name: 'job-griplock-migrate-dev'
    image: image
    registryServer: registryServer
    pullIdentityId: pullIdentityId
    command: ['node', 'server/migrate.mjs']
    databaseHost: database.properties.fullyQualifiedDomainName
    databaseName: devDatabase.name
    appUser: 'griplock_dev_app'
    adminPassword: postgresAdminPassword
    appPassword: postgresDevAppPassword
  }
}
output environmentId string = environment.id
output databaseHost string = database.properties.fullyQualifiedDomainName
output databaseServer string = database.name
output storageAccount string = objects.name
