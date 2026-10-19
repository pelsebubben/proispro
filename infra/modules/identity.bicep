// User-assigned managed identity used by the ACA API container.
// One identity, reused for: (1) ACR pull, (2) Azure SQL access via AAD.
// User-assigned (not system-assigned) so the identity exists before the
// container app and can be granted SQL access deterministically.

@description('Azure region for the identity.')
param location string

@description('Name of the user-assigned managed identity.')
param identityName string

@description('Tags applied to the identity.')
param tags object = {}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: identityName
  location: location
  tags: tags
}

output identityId string = identity.id
output principalId string = identity.properties.principalId
output clientId string = identity.properties.clientId
output identityName string = identity.name
