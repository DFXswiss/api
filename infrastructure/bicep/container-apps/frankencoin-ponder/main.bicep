@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Basename / Prefix of all resources')
@minLength(4)
@maxLength(12)
param baseName string

@description('Name of the private link service')
param privateLinkServiceName string = '${baseName}-aca-env-pl'

@description('Tags to be applied to all resources')
param tags object = {}

// Read existing resources
resource privateLinkService 'Microsoft.Network/privateLinkServices@2024-03-01' existing = {
  name: privateLinkServiceName
}

// Modules
module network './modules/network.bicep' = {
  name: 'network'
  params: {
    baseName: baseName
  }
}

module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    baseName: baseName
  }
}

module containerAppsEnv './modules/containerAppsEnv.bicep' = {
  name: 'containerAppsEnv'
  params: {
    baseName: baseName
    storageAccountName: storage.outputs.storageAccountName
    fileShareName: storage.outputs.fileShareName
  }
}

module containerApp './modules/containerApp.bicep' = {
  name: 'containerApp'
  params: {
    location: location
    baseName: baseName
    tags: tags
    containerAppsEnvironmentId: containerAppsEnv.outputs.containerAppsEnvironmentId
    containerImage: 'dfxswiss/frankencoin-ponder:beta'
    storageName: containerAppsEnv.outputs.storageName
  }
}

module frontDoor './modules/frontdoor.bicep' = {
  name: 'frontdoor'
  params: {
    baseName: baseName
    location: location
    privateLinkServiceId: privateLinkService.id
    frontDoorAppHostName: containerApp.outputs.containerFqdn
  }
}

// Output
output result object = {
  fqdn: frontDoor.outputs.fqdn
}
