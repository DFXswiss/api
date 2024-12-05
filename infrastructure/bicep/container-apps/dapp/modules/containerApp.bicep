// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container app')
param appName string

@description('Id of the Container Apps Environment')
param containerAppsEnvironmentId string

@description('Container Image')
param containerImage string

@description('Container CPU resource')
param containerCPU string

@description('Container memory resource')
param containerMemory string

@description('Container environment: NEXT_PUBLIC_LANDINGPAGE_URL')
param containerEnvNextPublicLandingPage string

@description('Container environment: NEXT_PUBLIC_APP_URL')
param containerEnvNextPublicAppUrl string

@description('Container environment: NEXT_PUBLIC_API_URL')
param containerEnvNextPublicApiUrl string

@description('Container environment: NEXT_PUBLIC_PONDER_URL')
param containerEnvNextPublicPonderUrl string

@description('Container environment: NEXT_PUBLIC_WAGMI_ID')
param containerEnvNextPublicWagmiId string

@description('Container environment: NEXT_PUBLIC_ALCHEMY_API_KEY')
param containerEnvNextPublicAlchemyApiKey string

@description('Container environment: NEXT_PUBLIC_CHAIN_NAME')
param containerEnvNextPublicChainName string

@description('Container environment: NEXT_PUBLIC_RPC_URL_MAINNET')
param containerEnvNextPublicRpcUrlMainnet string

@description('Container environment: NEXT_PUBLIC_RPC_URL_POLYGON')
param containerEnvNextPublicRpcUrlPolygon string

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
              name: 'NEXT_PUBLIC_LANDINGPAGE_URL'
              value: containerEnvNextPublicLandingPage
            }
            {
              name: 'NEXT_PUBLIC_APP_URL'
              value: containerEnvNextPublicAppUrl
            }
            {
              name: 'NEXT_PUBLIC_API_URL'
              value: containerEnvNextPublicApiUrl
            }
            {
              name: 'NEXT_PUBLIC_PONDER_URL'
              value: containerEnvNextPublicPonderUrl
            }
            {
              name: 'NEXT_PUBLIC_WAGMI_ID'
              value: containerEnvNextPublicWagmiId
            }
            {
              name: 'NEXT_PUBLIC_ALCHEMY_API_KEY'
              value: containerEnvNextPublicAlchemyApiKey
            }
            {
              name: 'NEXT_PUBLIC_CHAIN_NAME'
              value: containerEnvNextPublicChainName
            }
            {
              name: 'NEXT_PUBLIC_RPC_URL_MAINNET'
              value: containerEnvNextPublicRpcUrlMainnet
            }
            {
              name: 'NEXT_PUBLIC_RPC_URL_POLYGON'
              value: containerEnvNextPublicRpcUrlPolygon
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
