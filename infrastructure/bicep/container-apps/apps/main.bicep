// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the APP')
param app string

@description('Container image')
param containerImage string

@description('Container mount path')
param containerMountPath string

@description('Container CPU resource')
param containerCPU string

@description('Container memory resource')
param containerMemory string

@description('Container minimal replicas')
param containerMinReplicas int

@description('Container maximal replicas')
param containerMaxReplicas int

@description('Environment of the container app')
param containerEnv array

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

var withStorage = containerMountPath != ''

// --- MODULES --- //
module storage './modules/storage.bicep' = if (withStorage) {
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
    withStorage: withStorage
  }
}

module containerApp './modules/containerApp.bicep' = {
  name: 'containerApp'
  params: {
    appName: appName
    tags: tags
    containerAppsEnvironmentId: containerAppsEnv.outputs.containerAppsEnvironmentId
    containerImage: containerImage
    containerMountPath: containerMountPath
    storageName: environmentStorageName
    containerCPU: containerCPU
    containerMemory: containerMemory
    containerMinReplicas: containerMinReplicas
    containerMaxReplicas: containerMaxReplicas
    containerEnv: containerEnv
    withStorage: withStorage
  }
}

output result object = {
  containerImage: containerImage
  containerMountPath: containerMountPath
  containerCPU: containerCPU
  containerMemory: containerMemory
  containerMinReplicas: containerMinReplicas
  containerMaxReplicas: containerMaxReplicas
  containerEnv: containerEnv

  withStorage: withStorage

  environmentName: environmentName
  storageAccountName: storageAccountName
  fileShareName: fileShareName
  environmentStorageName: environmentStorageName
  appName: appName
}
