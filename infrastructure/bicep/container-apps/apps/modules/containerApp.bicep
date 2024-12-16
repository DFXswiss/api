// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container app')
param appName string

@description('Id of the Container Apps Environment')
param containerAppsEnvironmentId string

@description('Container image')
param containerImage string

@description('Container mount path')
param containerMountPath string

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

@description('Environment of the container app')
param containerEnv array

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

var volumeMounts = (withStorage
  ? [
      {
        volumeName: 'volume'
        mountPath: containerMountPath
      }
    ]
  : [])

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
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
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
          probes: []
          //          probes: [
          //            {
          //              type: 'Liveness'
          //              httpGet: {
          //                path: '/health'
          //                port: 3000
          //              }
          //              periodSeconds: 60
          //              failureThreshold: 3
          //              initialDelaySeconds: 10
          //            }
          //          ]
          env: containerEnv
          volumeMounts: volumeMounts
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
