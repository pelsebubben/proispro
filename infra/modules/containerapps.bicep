// Azure Container Apps — managed environment + the API container app.
// Consumption plan, HTTP autoscale, scale-to-zero friendly.
// The app authenticates to ACR and Azure SQL with a user-assigned identity;
// no registry admin creds and no SQL password are used.

@description('Azure region.')
param location string

@description('Name of the Container Apps managed environment.')
param environmentName string

@description('Name of the API container app.')
param containerAppName string

@description('Tags applied to the environment (not the app — the app carries azd-service tags).')
param tags object = {}

@description('Tags applied to the API container app (must include azd-service-name=api for azd).')
param appTags object = {}

@description('Log Analytics customer id for the environment.')
param logAnalyticsCustomerId string

@description('Log Analytics workspace resource id (used to read the shared key).')
param logAnalyticsWorkspaceId string

@description('Resource id of the user-assigned managed identity.')
param userAssignedIdentityId string

@description('Client id of the user-assigned managed identity (passed to the app as AZURE_CLIENT_ID).')
param userAssignedClientId string

@description('ACR login server, e.g. myregistry.azurecr.io.')
param acrLoginServer string

@description('Fully-qualified container image reference to run.')
param containerImage string

@description('Container port the API listens on.')
param containerPort int = 3000

@description('Minimum replicas. 0 = scale-to-zero (cheapest, cold start on first hit).')
@minValue(0)
param minReplicas int = 0

@description('Maximum replicas (horizontal ceiling).')
@minValue(1)
param maxReplicas int = 3

@description('Concurrent HTTP requests per replica before scaling out.')
param concurrentRequests int = 50

@description('vCPU per replica (0.25 is the Consumption minimum).')
param cpu string = '0.5'

@description('Memory per replica (must pair with cpu per ACA allowed combos).')
param memory string = '1.0Gi'

@description('FQDN of the Azure SQL server, passed to the app.')
param sqlServerFqdn string

@description('Database name, passed to the app.')
param sqlDatabaseName string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsCustomerId
        sharedKey: listKeys(logAnalyticsWorkspaceId, '2023-09-01').primarySharedKey
      }
    }
  }
}

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: appTags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${userAssignedIdentityId}': {}
    }
  }
  properties: {
    environmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        // External so the SWA linked backend can reach it. Lock down to the
        // SWA proxy in production (see runbook) — never trust the forwarded
        // principal header on a freely-public endpoint.
        external: true
        targetPort: containerPort
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acrLoginServer
          identity: userAssignedIdentityId
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'api'
          image: containerImage
          resources: {
            cpu: json(cpu)
            memory: memory
          }
          env: [
            {
              name: 'AZURE_CLIENT_ID'
              value: userAssignedClientId
            }
            {
              name: 'SQL_SERVER'
              value: sqlServerFqdn
            }
            {
              name: 'SQL_DATABASE'
              value: sqlDatabaseName
            }
            {
              name: 'PORT'
              value: string(containerPort)
            }
          ]
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: string(concurrentRequests)
              }
            }
          }
        ]
      }
    }
  }
}

output containerAppName string = containerApp.name
output containerAppFqdn string = containerApp.properties.configuration.ingress.fqdn
output containerAppResourceId string = containerApp.id
