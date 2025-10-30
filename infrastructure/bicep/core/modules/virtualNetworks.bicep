// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the virtual network')
param virtualNetworkName string

@description('Name of the SQL DB subnet')
param sqlDBSubNetName string

@description('Name of the VM subnet')
param vmSubNetName string

@description('Id of the network security group')
param networkSecurityGroupId string

// --- RESOURCES --- //
resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-10-01' = {
  name: virtualNetworkName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.1.0.0/16'
      ]
    }
    subnets: [
      {
        name: sqlDBSubNetName
        properties: {
          addressPrefix: '10.1.0.0/24'
          serviceEndpoints: [
            {
              service: 'Microsoft.Web'
              locations: [
                '*'
              ]
            }
            {
              service: 'Microsoft.Sql'
              locations: [
                '*'
              ]
            }
          ]
          delegations: [
            {
              name: '0'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Enabled'
          privateLinkServiceNetworkPolicies: 'Enabled'
        }
      }
      {
        name: vmSubNetName
        properties: {
          addressPrefix: '10.1.1.0/24'
          networkSecurityGroup: {
            id: networkSecurityGroupId
          }
          privateEndpointNetworkPolicies: 'Enabled'
          privateLinkServiceNetworkPolicies: 'Enabled'
        }
      }
    ]
  }
}
