// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the APP')
param app string

@description('Container Image')
param containerImage string

@description('Container CPU resource')
param containerCPU string

@description('Container memory resource')
param containerMemory string

@description('Container environment: PORT')
param containerEnvPort string

@description('Container environment: CONFIG_CHAIN')
param containerEnvConfigChain string

@description('Container environment: CONFIG_APP_URL')
param containerEnvConfigAppUrl string

@description('Container environment: CONFIG_INDEXER_URL')
param containerEnvConfigIndexerUrl string

@description('Container environment: COINGECKO_API_KEY')
param containerEnvCoingeckoApiKey string

@description('Container environment: RPC_URL_MAINNET')
param containerEnvRpcUrlMainnet string

@description('Container environment: RPC_URL_POLYGON')
param containerEnvRpcUrlPolygon string

@description('Container environment: TELEGRAM_BOT_TOKEN')
param containerEnvTelegramBotToken string

@description('Container environment: TELEGRAM_GROUPS_JSON')
param containerEnvTelegramGroupsJson string

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

// --- MODULES --- //
module storage './modules/storage.bicep' = {
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
  }
}

module containerApp './modules/containerApp.bicep' = {
  name: 'containerApp'
  params: {
    appName: appName
    tags: tags
    containerAppsEnvironmentId: containerAppsEnv.outputs.containerAppsEnvironmentId
    containerImage: containerImage
    storageName: environmentStorageName
    containerCPU: containerCPU
    containerMemory: containerMemory
    containerEnvPort: containerEnvPort
    containerEnvConfigChain: containerEnvConfigChain
    containerEnvConfigAppUrl: containerEnvConfigAppUrl
    containerEnvConfigIndexerUrl: containerEnvConfigIndexerUrl
    containerEnvCoingeckoApiKey: containerEnvCoingeckoApiKey
    containerEnvRpcUrlMainnet: containerEnvRpcUrlMainnet
    containerEnvRpcUrlPolygon: containerEnvRpcUrlPolygon
    containerEnvTelegramBotToken: containerEnvTelegramBotToken
    containerEnvTelegramGroupsJson: containerEnvTelegramGroupsJson
  }
}
