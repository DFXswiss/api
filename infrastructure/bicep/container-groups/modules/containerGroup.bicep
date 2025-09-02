// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container group')
param containerGroupName string

@description('Name of the container')
param containerName string

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

@description('Name of the storage account')
param storageAccountName string

@description('Name of the file share')
param fileShareName string

@description('Name of the log analytics workspace')
param logAnalyticsWorkspaceName string

@secure()
param dockerUsername string
@secure()
param dockerPassword string

param withStorage bool

// --- VARIABLES --- //
var volumeMounts = (withStorage ? containerVolumeMounts : [])

// --- EXISTING RESOURCES --- //
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = if (withStorage) {
  name: storageAccountName
}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: logAnalyticsWorkspaceName
}

// --- RESOURCES --- //
resource containerGroup 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: containerGroupName
  location: location
  properties: {
    containers: [
      {
        name: containerName
        properties: {
          image: containerImage
          resources: {
            requests: {
              cpu: containerCPU
              memoryInGB: containerMemory
            }
          }
          volumeMounts: volumeMounts
          environmentVariables: containerEnv
          command: containerCommand
        }
      }
    ]
    osType: 'Linux'
    restartPolicy: 'Never'
    volumes: [
      for mount in volumeMounts: {
        name: mount.name
        azureFile: {
          readOnly: mount.readOnly
          shareName: fileShareName
          storageAccountName: storageAccount.name
          storageAccountKey: storageAccount.listKeys().keys[0].value
        }
      }
    ]
    imageRegistryCredentials: [
      {
        server: 'index.docker.io'
        username: dockerUsername
        password: dockerPassword
      }
    ]
    diagnostics: {
      logAnalytics: {
        workspaceId: logAnalyticsWorkspace.properties.customerId
        workspaceKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}
