@description('Basename / Prefix of all resources')
param baseName string

@description('Azure Location/Region')
param location string

@description('Id of the Container Apps Environment')
param containerAppsEnvironmentId string

@description('Container Image')
param containerImage string

@description('Name of the storage')
param storageName string

@description('Name of the storage share')
param storageShareName string

@description('Tags to be applied to all resources')
param tags object = {}

// Define names
var appName = '${baseName}-ca-fp-app'

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
            cpu: json('0.5')
            memory: '1Gi'
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
              value: '3000'
            }
            {
              name: 'PONDER_PROFILE'
              value: 'mainnet'
            }
            {
              name: 'RPC_URL_MAINNET'
              value: 'https://eth-mainnet.g.alchemy.com/v2/tIcvTb9F_QApINtFsWad19a9QQt3KiFp'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'volume'
              subPath: storageShareName
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

output containerFqdn string = containerApp.properties.configuration.ingress.fqdn
