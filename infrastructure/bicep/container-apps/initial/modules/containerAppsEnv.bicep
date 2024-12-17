// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container app environment')
param environmentName string

@description('Name of the log analytics workspace')
param logAnalyticsWorkspaceName string

@description('Name of the managed cluster resource group')
param mcResourceGroupName string

@description('Subnet resource ID for the Container App environment')
param infrastructureSubnetId string

@description('Tags to be applied to all resources')
param tags object = {}

// --- EXISTING RESOURCES --- //
resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' existing = {
  name: logAnalyticsWorkspaceName
}

// --- RESOURCES --- //
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: environmentName
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
    vnetConfiguration: {
      infrastructureSubnetId: infrastructureSubnetId
      internal: env != 'loc' ? true : false
    }
    zoneRedundant: false
    infrastructureResourceGroup: mcResourceGroupName
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

// --- OUTPUT --- //
output containerAppsEnvironmentDefaultDomain string = environment.properties.defaultDomain
