@description('Basename / Prefix of all resources')
param baseName string

@description('Azure Location/Region')
param location string

@description('Tags to be applied to all resources')
param tags object = {}

// Define names
var vnetName = '${baseName}-vnet'
var subnetNsgName = '${baseName}-subnet-nsg'

// Read existing resources
resource vnet 'Microsoft.Network/virtualNetworks@2024-03-01' existing = {
  name: vnetName
}

resource subnetNsg 'Microsoft.Network/networkSecurityGroups@2024-03-01' existing = {
  name: subnetNsgName
}

// Create Subnet
resource subnet 'Microsoft.Network/virtualNetworks/subnets@2024-03-01' = {
  parent: vnet
  name: 'frankencoin-ponder-app-snet'
  properties: {
    addressPrefix: '10.0.2.0/23'
    networkSecurityGroup: {
      id: subnetNsg.id
    }
    privateLinkServiceNetworkPolicies: 'Disabled'
  }
}

output containerAppsSubnetid string = subnet.id
