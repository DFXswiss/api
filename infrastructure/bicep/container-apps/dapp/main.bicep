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

@description('Container environment: NEXT_PUBLIC_LANDINGPAGE_URL')
param containerEnvNextPublicLandingPage string

@description('Container environment: NEXT_PUBLIC_APP_URL')
param containerEnvNextPublicAppUrl string

@description('Container environment: NEXT_PUBLIC_API_URL')
param containerEnvNextPublicApiUrl string
@description('Container environment: NEXT_PUBLIC_PONDER_URL')
param containerEnvNextPublicPonderUrl string

@description('Container environment: NEXT_PUBLIC_CHAIN_NAME')
param containerEnvNextPublicChainName string

@description('Tags to be applied to all resources')
param tags object = {}

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'

var environmentName = 'cae-${compName}-${apiName}-${env}'

var appName = 'ca-${compName}-${app}-${env}'

// --- MODULES --- //
module containerAppsEnv './modules/containerAppsEnv.bicep' = {
  name: 'containerAppsEnv'
  params: {
    environmentName: environmentName
  }
}

module containerApp './modules/containerApp.bicep' = {
  name: 'containerApp'
  params: {
    appName: appName
    tags: tags
    containerAppsEnvironmentId: containerAppsEnv.outputs.containerAppsEnvironmentId
    containerImage: containerImage
    containerCPU: containerCPU
    containerMemory: containerMemory
    containerEnvNextPublicLandingPage: containerEnvNextPublicLandingPage
    containerEnvNextPublicAppUrl: containerEnvNextPublicAppUrl
    containerEnvNextPublicApiUrl: containerEnvNextPublicApiUrl
    containerEnvNextPublicPonderUrl: containerEnvNextPublicPonderUrl
    containerEnvNextPublicChainName: containerEnvNextPublicChainName
  }
}
