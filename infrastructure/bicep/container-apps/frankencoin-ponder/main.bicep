@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Basename / Prefix of all resources')
@minLength(4)
@maxLength(12)
param baseName string

@description('Name of the environment')
param environmentName string = '${baseName}-aca-env'

@description('Name of the environment storage')
param environmentStorageName string = 'fileshare-app-test'

@description('Name of the private link service')
param privateLinkServiceName string = '${baseName}-aca-env-pl'

@description('Tags to be applied to all resources')
param tags object = {}

// Read existing resources
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource privateLinkService 'Microsoft.Network/privateLinkServices@2024-03-01' existing = {
  name: privateLinkServiceName
}

// Modules
module network './modules/network.bicep' = {
  name: 'network'
  params: {
    location: location
    baseName: baseName
    tags: tags
  }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    location: location
    baseName: baseName
    tags: tags
  }
}

module containerAppsEnv './modules/containerAppsEnv.bicep' = {
  name: 'containerAppsEnv'
  params: {
    location: location
    baseName: baseName
    tags: tags
    storageAccountName: storage.outputs.storageAccountName
    infrastructureSubnetId: network.outputs.containerAppsSubnetid
  }
}

module containerApp './modules/containerApp.bicep' = {
  name: 'containerApp'
  params: {
    location: location
    baseName: baseName
    tags: tags
    containerAppsEnvironmentId: environment.id
    containerImage: 'dfxswiss/frankencoin-ponder:beta'
    storageName: environmentStorageName
    storageShareName: containerAppsEnv.outputs.storageShareName
  }
}

module frontDoor './modules/frontdoor.bicep' = {
  name: 'frontdoor'
  params: {
    baseName: baseName
    location: location
    tags: tags
    privateLinkServiceId: privateLinkService.id
    frontDoorAppHostName: containerApp.outputs.containerFqdn
  }
}

// Output
output result object = {
  fqdn: frontDoor.outputs.fqdn
}
