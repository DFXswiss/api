// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the company')
param compName string

@description('Deployment environment')
param env string

@description('Name of the resource group')
param rg string

@description('Private IP address of the subnet')
param privateIPAddress string

@description('Frontend- and Backend port')
param frontendPort int
param backendPort int

@description('Name and port of the probe')
param probeName string
param probePort int

// --- VARIABLES --- //
var vm = 'vm'

var virtualNetworkName = 'vnet-${compName}-${rg}-${env}'
var subnetName = 'snet-${compName}-${vm}-${env}'

var loadBalancerName = 'lbi-${compName}-${rg}-${env}'
var frontendIPConfigurationName = 'feic-${compName}-${vm}-${env}'
var backendAddressPoolName = 'bep-${compName}-${vm}-${env}'
var loadBalancingRuleName = 'lbr-${compName}-${vm}-${env}'

// --- EXISTING RESOURCES --- //
resource virtualNetwork 'Microsoft.Network/virtualNetworks@2023-05-01' existing = {
  name: virtualNetworkName
}

resource subnet 'Microsoft.Network/virtualNetworks/subnets@2023-05-01' existing = {
  parent: virtualNetwork
  name: subnetName
}

// --- RESOURCES --- //
resource loadBalancer 'Microsoft.Network/loadBalancers@2024-10-01' = {
  name: loadBalancerName
  location: location
  properties: {
    frontendIPConfigurations: [
      {
        name: frontendIPConfigurationName
        properties: {
          privateIPAddress: privateIPAddress
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: subnet.id
          }
        }
      }
    ]
    backendAddressPools: [
      {
        name: backendAddressPoolName
      }
    ]
    loadBalancingRules: [
      {
        name: loadBalancingRuleName
        properties: {
          frontendIPConfiguration: {
            id: resourceId(
              'Microsoft.Network/loadBalancers/frontendIPConfigurations',
              loadBalancerName,
              frontendIPConfigurationName
            )
          }
          backendAddressPool: {
            id: resourceId(
              'Microsoft.Network/loadBalancers/backendAddressPools',
              loadBalancerName,
              backendAddressPoolName
            )
          }
          probe: {
            id: resourceId('Microsoft.Network/loadBalancers/probes', loadBalancerName, probeName)
          }
          frontendPort: frontendPort
          backendPort: backendPort
          protocol: 'Tcp'
          idleTimeoutInMinutes: 4
          enableTcpReset: false
          loadDistribution: 'Default'
          disableOutboundSnat: true
        }
      }
    ]
    probes: [
      {
        name: probeName
        properties: {
          protocol: 'Tcp'
          port: probePort
          intervalInSeconds: 60
          numberOfProbes: 1
          probeThreshold: 1
        }
      }
    ]
  }
}
