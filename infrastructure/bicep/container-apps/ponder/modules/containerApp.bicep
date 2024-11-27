// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container app')
param appName string

@description('Id of the Container Apps Environment')
param containerAppsEnvironmentId string

@description('Container Image')
param containerImage string

@description('Name of the storage')
param storageName string

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
        targetPort: int(containerEnvPort)
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      volumes: [
        {
          name: 'volume'
          storageType: 'AzureFile'
          storageName: storageName
          mountOptions: 'nobrl,cache=none'
        }
      ]
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
          env: [
            {
              name: 'PORT'
              value: containerEnvPort
            }
            {
              name: 'PONDER_PROFILE'
              value: containerEnvPonderProfile
            }
            {
              name: 'RPC_URL_MAINNET'
              value: containerEnvRpcUrlMainnet
            }
          ]
          volumeMounts: [
            {
              volumeName: 'volume'
              mountPath: '/app/.ponder'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// --- OUTPUT --- //
output containerFqdn string = containerApp.properties.configuration.ingress.fqdn
