// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the APP')
param app string

@description('Quota of the file share')
param fileShareQuota int

@description('Container image')
param containerImage string

@description('Container volume mounts')
param containerVolumeMounts array

@description('Container CPU resource')
param containerCPU string

@description('Container memory resource')
param containerMemory string

@description('Container minimal replicas')
param containerMinReplicas int

@description('Container maximal replicas')
param containerMaxReplicas int

@description('Container ingress target port')
param containerIngressTargetPort int

@description('Container ingress additional ports')
param containerIngressAdditionalPorts array

@description('Probes of the container app')
param containerProbes array

@description('Environment of the container app')
param containerEnv array

@description('Command of the container app')
param containerCommand array

@description('Arguments of the container app')
param containerArgs array

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

var withStorage = !empty(containerVolumeMounts)

// --- MODULES --- //
module storage './modules/storage.bicep' = if (withStorage) {
  name: 'storage'
  params: {
    storageAccountName: storageAccountName
    fileShareName: fileShareName
    fileShareQuota: fileShareQuota
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
    containerVolumeMounts: containerVolumeMounts
    storageName: environmentStorageName
    containerCPU: containerCPU
    containerMemory: containerMemory
    containerMinReplicas: containerMinReplicas
    containerMaxReplicas: containerMaxReplicas
    containerIngressTargetPort: containerIngressTargetPort
    containerIngressAdditionalPorts: containerIngressAdditionalPorts
    containerProbes: containerProbes
    containerEnv: containerEnv
    containerCommand: containerCommand
    containerArgs: containerArgs
    withStorage: withStorage
  }
}

output result object = {
  containerImage: containerImage
  containerVolumeMounts: containerVolumeMounts
  containerCPU: containerCPU
  containerMemory: containerMemory
  containerMinReplicas: containerMinReplicas
  containerMaxReplicas: containerMaxReplicas
  containerProbes: containerProbes
  containerEnv: containerEnv
  containerCommand: containerCommand

  environmentName: environmentName
  storageAccountName: storageAccountName
  fileShareName: fileShareName
  environmentStorageName: environmentStorageName
  appName: appName
}
