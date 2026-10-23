targetScope = 'subscription'

@description('Azure region for the staging resource group. No paid services are created yet.')
param location string

@minLength(1)
@maxLength(90)
param resourceGroupName string

resource staging 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: resourceGroupName
  location: location
  tags: {
    application: 'griplock'
    environment: 'staging'
    managedBy: 'bicep'
    repository: 'pelsebubben/proispro'
  }
}

output resourceGroupId string = staging.id
