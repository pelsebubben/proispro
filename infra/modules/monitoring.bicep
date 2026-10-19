// Log Analytics workspace — backs the Container Apps managed environment.
// Cheapest sensible config: PerGB2018, 30-day retention, daily cap to bound cost.

@description('Azure region for the workspace.')
param location string

@description('Name of the Log Analytics workspace.')
param workspaceName string

@description('Tags applied to the workspace.')
param tags object = {}

@description('Retention in days (30 is the free-tier floor).')
@minValue(30)
@maxValue(730)
param retentionInDays int = 30

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
    features: {
      enableLogAccessUsingOnlyResourcePermissions: true
    }
    workspaceCapping: {
      // Hobby-scale guardrail: cap ingestion at 1 GB/day so a runaway log never surprises the bill.
      dailyQuotaGb: 1
    }
  }
}

output workspaceId string = workspace.id
output customerId string = workspace.properties.customerId
