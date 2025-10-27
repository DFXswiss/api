// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the Instance')
param instance string

@description('Quota of the file share')
param fileShareQuota int

@description('Container image')
param containerImage string

@description('Container volume mounts')
param containerVolumeMounts array

@description('Environment of the container')
param containerEnv array

@description('Command of the container')
param containerCommand array

@description('Container CPU resource')
param containerCPU int

@description('Container memory resource')
param containerMemory int

@secure()
param dockerUsername string
@secure()
param dockerPassword string

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'

var containerGroupName = 'ci-${compName}-${instance}-${env}'
var storageAccountName = replace('st-${compName}-${apiName}-${env}', '-', '')
var fileShareName = 'ci-${instance}'
var logAnalyticsWorkspaceName = 'log-${compName}-${apiName}-${env}'

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

module containerGroup './modules/containerGroup.bicep' = {
  name: 'containerGroup'
  params: {
    containerGroupName: containerGroupName
    containerName: instance
    containerImage: containerImage
    containerVolumeMounts: containerVolumeMounts
    containerEnv: containerEnv
    containerCommand: containerCommand
    containerCPU: containerCPU
    containerMemory: containerMemory
    storageAccountName: storageAccountName
    fileShareName: fileShareName
    logAnalyticsWorkspaceName: logAnalyticsWorkspaceName
    dockerUsername: dockerUsername
    dockerPassword: dockerPassword
    withStorage: withStorage
  }
  dependsOn: [
    storage
  ]
}
