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

@description('Container environment: CONFIG_PROFILE')
param containerEnvConfigProfile string

@description('Container environment: CONFIG_CHAIN')
param containerEnvConfigChain string

@description('Container environment: CONFIG_APP_URL')
param containerEnvConfigAppUrl string

@description('Container environment: CONFIG_INDEXER_URL')
param containerEnvConfigIndexerUrl string

@description('Container environment: COINGECKO_API_KEY')
param containerEnvCoingeckoApiKey string

@description('Container environment: TELEGRAM_BOT_TOKEN')
param containerEnvTelegramBotToken string

@description('Container environment: RPC_URL_MAINNET')
param containerEnvRpcUrlMainnet string

@description('Container environment: RPC_URL_POLYGON')
param containerEnvRpcUrlPolygon string

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
              name: 'CONFIG_PROFILE'
              value: containerEnvConfigProfile
            }
            {
              name: 'CONFIG_CHAIN'
              value: containerEnvConfigChain
            }
            {
              name: 'CONFIG_APP_URL'
              value: containerEnvConfigAppUrl
            }
            {
              name: 'CONFIG_INDEXER_URL'
              value: containerEnvConfigIndexerUrl
            }
            {
              name: 'COINGECKO_API_KEY'
              value: containerEnvCoingeckoApiKey
            }
            {
              name: 'TELEGRAM_BOT_TOKEN'
              value: containerEnvTelegramBotToken
            }
            {
              name: 'RPC_URL_MAINNET'
              value: containerEnvRpcUrlMainnet
            }
            {
              name: 'RPC_URL_POLYGON'
              value: containerEnvRpcUrlPolygon
            }
          ]
          volumeMounts: [
            {
              volumeName: 'volume'
              mountPath: '/app/.api'
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
