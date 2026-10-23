targetScope = 'resourceGroup'

param location string = resourceGroup().location
param pipelinePrincipalId string
var tags = { application: 'griplock', environment: 'staging', managedBy: 'bicep' }

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'crgrip${uniqueString(subscription().id, resourceGroup().id)}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-griplock-staging-pull'
  location: location
  tags: tags
}
resource pull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullIdentity.id, 'AcrPull')
  scope: registry
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}
resource push 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pipelinePrincipalId, 'AcrPush')
  scope: registry
  properties: {
    principalId: pipelinePrincipalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '8311e382-0749-4cb8-b61a-304f252e45ec')
  }
}
output registryName string = registry.name
output registryServer string = registry.properties.loginServer
output pullIdentityId string = pullIdentity.id
