// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the virtual network')
param vnetName string

@description('Name of the network security group for the container apps')
param caNsgName string

@description('Name of the subnet for the container apps')
param subnetName string

@description('Tags to be applied to all resources')
param tags object = {}

// --- EXISTING RESOURCES --- //
resource vnet 'Microsoft.Network/virtualNetworks@2024-03-01' existing = {
  name: vnetName
}

// --- RESOURCES --- //
resource subnetNsg 'Microsoft.Network/networkSecurityGroups@2024-03-01' = {
  name: caNsgName
  location: location
  tags: tags
  properties: {
    securityRules: []
  }
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2024-03-01' = {
  parent: vnet
  name: subnetName
  properties: {
    addressPrefix: '10.0.10.0/23'
    networkSecurityGroup: {
      id: subnetNsg.id
    }
    privateLinkServiceNetworkPolicies: 'Disabled'
    delegations: [
      {
        name: 'Microsoft.App/environments'
        properties: {
          serviceName: 'Microsoft.App/environments'
        }
      }
    ]
  }
}

// --- OUTPUT --- //
output containerAppsSubnetid string = subnet.id
