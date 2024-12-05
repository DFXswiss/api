// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Tags to be applied to all resources')
param tags object = {}

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'

var mcResourceGroupName = 'mc-${compName}-${apiName}-${env}'

var vnetName = 'vnet-${compName}-${apiName}-${env}'
var caNsgName = 'nsg-${compName}-ca-${env}'
var subnetName = 'snet-${compName}-ca-${env}'

var environmentName = 'cae-${compName}-${apiName}-${env}'
var logAnalyticsWorkspaceName = 'log-${compName}-${apiName}-${env}'

// --- MODULES --- //
module network './modules/network.bicep' = {
  name: 'network'
  params: {
    vnetName: vnetName
    caNsgName: caNsgName
    subnetName: subnetName
    tags: tags
  }
}

module containerAppsEnv './modules/containerAppsEnv.bicep' = {
  name: 'containerAppsEnv'
  params: {
    environmentName: environmentName
    logAnalyticsWorkspaceName: logAnalyticsWorkspaceName
    mcResourceGroupName: mcResourceGroupName
    tags: tags
    infrastructureSubnetId: network.outputs.containerAppsSubnetid
  }
}
