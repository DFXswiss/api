// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container app')
param appName string

@description('Id of the Container Apps Environment')
param containerAppsEnvironmentId string

@description('Container image')
param containerImage string

@description('Container volume mounts')
param containerVolumeMounts array

@description('Name of the storage')
param storageName string

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

param withStorage bool

// --- VARIABLES --- //
var volumes = (withStorage
  ? [
      {
        name: 'volume'
        storageType: 'AzureFile'
        storageName: storageName
        mountOptions: 'nobrl,cache=none'
      }
    ]
  : [])

var volumeMounts = (withStorage ? containerVolumeMounts : [])

// --- RESOURCES --- //
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    environmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: containerIngressTargetPort
        transport: 'auto'
        allowInsecure: false
        additionalPortMappings: containerIngressAdditionalPorts
      }
    }
    template: {
      volumes: volumes
      containers: [
        {
          name: 'app'
          image: containerImage
          resources: {
            cpu: json(containerCPU)
            memory: containerMemory
          }
          probes: containerProbes
          env: containerEnv
          volumeMounts: volumeMounts
          command: containerCommand
          args: containerArgs
        }
      ]
      scale: {
        minReplicas: containerMinReplicas
        maxReplicas: containerMaxReplicas
      }
    }
  }
}

// --- OUTPUT --- //
output containerFqdn string = containerApp.properties.configuration.ingress.fqdn
