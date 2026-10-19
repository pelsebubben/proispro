// proispro — Azure Infrastructure-as-Code (Phase 1).
//
// Target architecture (see docs/adr-azure-entra-rebuild.md):
//   Static Web App (SPA + Entra EasyAuth)  --linked backend-->  Container Apps API
//                                                                     |
//                                 managed identity (AcrPull)  <---- ACR (image)
//                                 managed identity (AAD) ----> Azure SQL serverless
//   Container Apps environment  ---->  Log Analytics workspace
//
// Scope: subscription. azd (or `az deployment sub create`) deploys this; it
// creates the resource group and all resources with stable, token-suffixed
// names. Nothing here deploys application code — image + SPA come from CI/azd.

targetScope = 'subscription'

@minLength(1)
@maxLength(64)
@description('Environment name (azd env). Used for the RG name and resource tags.')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Base name used to derive resource names (lowercase, short).')
param baseName string = 'proispro'

@description('Container image for the API. Defaults to a hello-world so the very first deploy succeeds; CI/azd then pushes the real image and updates the revision.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Port the API container listens on.')
param containerPort int = 3000

@description('Minimum ACA replicas. 0 = scale-to-zero (default, cheapest).')
@minValue(0)
param minReplicas int = 0

@description('Maximum ACA replicas.')
@minValue(1)
param maxReplicas int = 3

@description('Minimum serverless SQL vCores (string; 0.5 is the cheapest floor).')
param sqlMinCapacity string = '0.5'

@description('Maximum serverless SQL vCores.')
@minValue(1)
param sqlMaxCapacity int = 1

@description('Idle minutes before Azure SQL auto-pauses. -1 disables auto-pause.')
param sqlAutoPauseDelayMinutes int = 60

@description('Display name (login) of the Entra admin for Azure SQL.')
param sqlAadAdminLogin string

@description('Entra object id (user or group) set as the Azure SQL admin. Required.')
param sqlAadAdminObjectId string

// Short deterministic token keeps globally-unique names (ACR, SQL, SWA) stable
// across redeploys of the same env, but unique per subscription/env/region.
var resourceToken = toLower(uniqueString(subscription().id, environmentName, location))
var tags = {
  'azd-env-name': environmentName
  project: baseName
}

var resourceGroupName = 'rg-${baseName}-${environmentName}'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module monitoring 'modules/monitoring.bicep' = {
  scope: rg
  name: 'monitoring'
  params: {
    location: location
    workspaceName: 'log-${baseName}-${resourceToken}'
    tags: tags
  }
}

module identity 'modules/identity.bicep' = {
  scope: rg
  name: 'identity'
  params: {
    location: location
    identityName: 'id-${baseName}-${resourceToken}'
    tags: tags
  }
}

module registry 'modules/registry.bicep' = {
  scope: rg
  name: 'registry'
  params: {
    location: location
    // ACR names: alphanumeric only, no hyphens.
    registryName: 'acr${baseName}${resourceToken}'
    tags: tags
    pullPrincipalId: identity.outputs.principalId
  }
}

module sql 'modules/sql.bicep' = {
  scope: rg
  name: 'sql'
  params: {
    location: location
    sqlServerName: 'sql-${baseName}-${resourceToken}'
    databaseName: '${baseName}db'
    tags: tags
    aadAdminLogin: sqlAadAdminLogin
    aadAdminObjectId: sqlAadAdminObjectId
    minCapacity: sqlMinCapacity
    maxCapacity: sqlMaxCapacity
    autoPauseDelayMinutes: sqlAutoPauseDelayMinutes
  }
}

module api 'modules/containerapps.bicep' = {
  scope: rg
  name: 'containerapps'
  params: {
    location: location
    environmentName: 'cae-${baseName}-${resourceToken}'
    containerAppName: 'ca-${baseName}-api-${resourceToken}'
    tags: tags
    // azd matches this tag to the "api" service in azure.yaml.
    appTags: union(tags, { 'azd-service-name': 'api' })
    logAnalyticsCustomerId: monitoring.outputs.customerId
    logAnalyticsWorkspaceId: monitoring.outputs.workspaceId
    userAssignedIdentityId: identity.outputs.identityId
    userAssignedClientId: identity.outputs.clientId
    acrLoginServer: registry.outputs.loginServer
    containerImage: containerImage
    containerPort: containerPort
    minReplicas: minReplicas
    maxReplicas: maxReplicas
    sqlServerFqdn: sql.outputs.sqlServerFqdn
    sqlDatabaseName: sql.outputs.databaseName
  }
}

module web 'modules/staticwebapp.bicep' = {
  scope: rg
  name: 'staticwebapp'
  params: {
    location: location
    staticWebAppName: 'swa-${baseName}-${resourceToken}'
    // azd matches this tag to the "web" service in azure.yaml.
    tags: union(tags, { 'azd-service-name': 'web' })
  }
}

// ---- Outputs (consumed by azd and the CI workflow) ----
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_LOCATION string = location
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.outputs.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.outputs.registryName
output API_CONTAINER_APP_NAME string = api.outputs.containerAppName
output API_BASE_URL string = 'https://${api.outputs.containerAppFqdn}'
output API_CONTAINER_APP_RESOURCE_ID string = api.outputs.containerAppResourceId
output WEB_STATIC_WEB_APP_NAME string = web.outputs.staticWebAppName
output WEB_BASE_URL string = 'https://${web.outputs.defaultHostname}'
output SQL_SERVER_FQDN string = sql.outputs.sqlServerFqdn
output SQL_DATABASE_NAME string = sql.outputs.databaseName
output API_MANAGED_IDENTITY_CLIENT_ID string = identity.outputs.clientId
output API_MANAGED_IDENTITY_NAME string = identity.outputs.identityName
