// --- PARAMETERS --- //
@description('Name of the container app environment')
param environmentName string

// --- EXISTING RESOURCES --- //
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

// --- OUTPUT --- //
output containerAppsEnvironmentId string = environment.id
output containerAppsEnvironmentStaticIp string = environment.properties.staticIp
output containerAppsEnvironmentDefaultDomain string = environment.properties.defaultDomain
