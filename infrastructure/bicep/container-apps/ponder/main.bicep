// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the APP')
param app string

@description('Container Image')
param containerImage string

@description('Container CPU resource')
param containerCPU string

@description('Container memory resource')
param containerMemory string

@description('Container environment: PORT')
param containerEnvPort string

@description('Container environment: PONDER_PROFILE')
param containerEnvPonderProfile string

@description('Container environment: RPC_URL_MAINNET')
param containerEnvRpcUrlMainnet string

@description('Tags to be applied to all resources')
param tags object = {}

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'

var environmentName = 'cae-${compName}-${apiName}-${env}'
var storageAccountName = replace('st-${compName}-${apiName}-${env}', '-', '')
var fileShareName = 'ca-${app}'
var environmentStorageName = 'share-${compName}-${app}-${env}'

var appName = 'ca-${compName}-${app}-${env}'

//var frontDoorProfileName = 'afd-${compName}-${apiName}-${env}'
//var frontDoorEndpointName = 'fde-${compName}-${app}-${env}'
//var frontDoorOriginGroupName = 'fdog-${compName}-${app}-${env}'
//var frontDoorOriginRouteName = 'fdor-${compName}-${app}-${env}'
//var frontDoorOriginName = 'fdon-${compName}-${app}-${env}'

// --- MODULES --- //
module storage './modules/storage.bicep' = {
  name: 'storage'
  params: {
    storageAccountName: storageAccountName
    fileShareName: fileShareName
  }
}

module containerAppsEnv './modules/containerAppsEnv.bicep' = {
  name: 'containerAppsEnv'
  params: {
    environmentName: environmentName
    environmentStorageName: environmentStorageName
    storageAccountName: storageAccountName
    fileShareName: fileShareName
  }
}

module containerApp './modules/containerApp.bicep' = {
  name: 'containerApp'
  params: {
    appName: appName
    tags: tags
    containerAppsEnvironmentId: containerAppsEnv.outputs.containerAppsEnvironmentId
    containerImage: containerImage
    storageName: environmentStorageName
    containerCPU: containerCPU
    containerMemory: containerMemory
    containerEnvPort: containerEnvPort
    containerEnvPonderProfile: containerEnvPonderProfile
    containerEnvRpcUrlMainnet: containerEnvRpcUrlMainnet
  }
}

/*
module frontDoor './modules/frontdoor.bicep' = {
  name: 'frontdoor'
  params: {
    environmentName: environmentName
    frontDoorProfileName: frontDoorProfileName
    frontDoorEndpointName: frontDoorEndpointName
    frontDoorOriginGroupName: frontDoorOriginGroupName
    frontDoorOriginRouteName: frontDoorOriginRouteName
    frontDoorOriginName: frontDoorOriginName
    frontDoorAppHostName: containerApp.outputs.containerFqdn
  }
}

// --- OUTPUT --- //
output result object = {
  fqdn: frontDoor.outputs.fqdn
}
*/
