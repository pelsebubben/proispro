// Azure Container Registry — stores the API container image.
// Basic SKO is the cheapest tier and is plenty for a single hobby image.
// Grants AcrPull to the supplied managed-identity principal so the ACA app
// can pull without admin credentials (admin user stays disabled).

@description('Azure region for the registry.')
param location string

@description('Globally-unique ACR name (alphanumeric, 5-50 chars).')
param registryName string

@description('Tags applied to the registry.')
param tags object = {}

@description('Principal (object) id of the identity that needs AcrPull.')
param pullPrincipalId string

// Built-in AcrPull role definition id (constant across tenants).
var acrPullRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullPrincipalId, acrPullRoleId)
  scope: registry
  properties: {
    roleDefinitionId: acrPullRoleId
    principalId: pullPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output registryName string = registry.name
output loginServer string = registry.properties.loginServer
