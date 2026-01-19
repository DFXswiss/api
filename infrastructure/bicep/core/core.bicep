// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the resource group')
param rg string

@description('Allowed IP range for the network security group')
param allowedIpRange string

@description('DB parameters')
param dbAllowAllIps bool
param dbAdminLogin string
@secure()
param dbAdminPassword string
param dbTier string
param dbCapacity int

// --- VARIABLES --- //
var compName = 'dfx'

var vmNetworkSecurityGroupName = 'nsg-${compName}-${rg}-vm-${env}'

var virtualNetworkName = 'vnet-${compName}-${rg}-${env}'
var sqlDBSubNetName = 'snet-${compName}-${rg}-sqldb-${env}'
var vmSubNetName = 'snet-${compName}-${rg}-vm-${env}'

var logAnalyticsWorkspaceName = 'log-${compName}-${rg}-${env}'
var applicationInsightsName = 'appi-${compName}-${rg}-${env}'

var sqlServerName = 'sql-${compName}-${rg}-${env}'
var sqlDbName = 'sqldb-${compName}-${rg}-${env}'

var storageAccountName = 'st${compName}${rg}${env}'

// --- MODULES --- //
module networkSecurityGroup './modules/networkSecurityGroups.bicep' = {
  name: 'networkSecurityGroup'
  params: {
    vmNetworkSecurityGroupName: vmNetworkSecurityGroupName
    allowedIpRange: allowedIpRange
  }
}

module virtualNetworks './modules/virtualNetworks.bicep' = {
  name: 'virtualNetworks'
  params: {
    virtualNetworkName: virtualNetworkName
    sqlDBSubNetName: sqlDBSubNetName
    vmSubNetName: vmSubNetName
    networkSecurityGroupId: networkSecurityGroup.outputs.networkSecurityGroupId
  }
}

module logAnalytics './modules/logAnalytics.bicep' = {
  name: 'logAnalytics'
  params: {
    logAnalyticsWorkspaceName: logAnalyticsWorkspaceName
  }
}

module applicationInsights './modules/applicationInsights.bicep' = {
  name: 'applicationInsights'
  params: {
    applicationInsightsName: applicationInsightsName
  }
}

module sqlServer './modules/sqlServer.bicep' = {
  name: 'sqlServer'
  params: {
    virtualNetworkName: virtualNetworkName
    sqlServerName: sqlServerName
    sqlDbName: sqlDbName
    dbAllowAllIps: dbAllowAllIps
    dbAdminLogin: dbAdminLogin
    dbAdminPassword: dbAdminPassword
    dbTier: dbTier
    dbCapacity: dbCapacity
  }
  dependsOn: [
    virtualNetworks
  ]
}

module storageAccount './modules/storageAccount.bicep' = {
  name: 'storageAccount'
  params: {
    storageAccountName: storageAccountName
  }
}
