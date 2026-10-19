// Azure SQL — logical server + a single serverless (auto-pause) database.
// Serverless GP_S_Gen5 bills compute only while active and auto-pauses to
// storage-only cost when idle: the cheapest realistic "real DB" for bursty use.
//
// Auth model: Entra-only (azureADOnlyAuthentication = true). No SQL password.
// An Entra admin (user or group) is set so a human can run the post-deploy
// `CREATE USER ... FROM EXTERNAL PROVIDER` grant for the ACA managed identity.
// See docs/azure-provisioning.md for that SQL snippet.

@description('Azure region for the SQL server.')
param location string

@description('Globally-unique logical SQL server name.')
param sqlServerName string

@description('Database name.')
param databaseName string

@description('Tags applied to the SQL resources.')
param tags object = {}

@description('Display name (login) of the Entra admin for the SQL server.')
param aadAdminLogin string

@description('Entra object id (user or group) set as the SQL server admin.')
param aadAdminObjectId string

@description('Entra tenant id for the SQL admin.')
param aadAdminTenantId string = subscription().tenantId

@description('Minimum serverless vCores as a string (0.5 is the floor and cheapest). Bicep has no float type, so pass it as text and json() parses it.')
param minCapacity string = '0.5'

@description('Maximum serverless vCores (ceiling of auto-scale).')
@minValue(1)
param maxCapacity int = 1

@description('Idle minutes before the DB auto-pauses to storage-only cost. -1 disables auto-pause.')
param autoPauseDelayMinutes int = 60

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: sqlServerName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    // Entra-only: no SQL login/password exists on this server.
    administrators: {
      administratorType: 'ActiveDirectory'
      principalType: 'User'
      login: aadAdminLogin
      sid: aadAdminObjectId
      tenantId: aadAdminTenantId
      azureADOnlyAuthentication: true
    }
  }
}

resource database 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  tags: tags
  sku: {
    // GP_S_Gen5 = General Purpose, Serverless, Gen5 hardware.
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: maxCapacity
  }
  properties: {
    minCapacity: json(minCapacity)
    autoPauseDelay: autoPauseDelayMinutes
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
    maxSizeBytes: 2147483648
  }
}

// Allow other Azure services (the ACA app) to reach the server. The 0.0.0.0
// special rule means "Allow Azure services", not the public internet.
resource allowAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output sqlServerName string = sqlServer.name
output sqlServerFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = database.name
