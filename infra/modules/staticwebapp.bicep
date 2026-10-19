// Azure Static Web Apps — hosts the React SPA + Entra ID (EasyAuth) sign-in.
// Standard tier is required for linked backends (the ACA API is linked
// post-deploy; see docs/azure-provisioning.md). Deployment of assets is done
// by CI / azd, so no repository build config is set here.

@description('Azure region. SWA is available in a limited set of regions; westeurope/eastus2 are safe.')
param location string

@description('Name of the Static Web App.')
param staticWebAppName string

@description('Tags applied to the SWA (must include azd-service-name=web for azd).')
param tags object = {}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    // Standard is mandatory for linked backends + custom auth.
    name: 'Standard'
    tier: 'Standard'
  }
  properties: {
    // Deploys are driven by the GitHub Actions workflow / azd, not SWA's own
    // build pipeline, so no repositoryUrl/buildProperties are set.
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
  }
}

output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output staticWebAppResourceId string = staticWebApp.id
