// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the VM network security group')
param vmNetworkSecurityGroupName string

@description('Allowed IP range for the network security group')
param allowedIpRange string

// --- RESOURCES --- //
resource networkSecurityGroup 'Microsoft.Network/networkSecurityGroups@2024-10-01' = {
  name: vmNetworkSecurityGroupName
  location: location
  properties: {
    securityRules: [
      {
        name: 'SSH'
        properties: {
          protocol: 'TCP'
          sourcePortRange: '*'
          destinationPortRange: '22'
          sourceAddressPrefix: allowedIpRange
          destinationAddressPrefix: '*'
          access: 'Allow'
          priority: 300
          direction: 'Inbound'
        }
      }
    ]
  }
}

// --- OUTPUT --- //
output networkSecurityGroupId string = networkSecurityGroup.id
