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

//@description('Frontend- and Backend port')
param frontendPort int = -1
param backendPort int = -1

@description('Name and port of the probe')
param probeName string = ''
param probePort int = -1

// --- VARIABLES --- //
var vm = 'vm'

var virtualNetworkName = 'vnet-${compName}-${rg}-${env}'
var subnetName = 'snet-${compName}-${rg}-${vm}-${env}'

var loadBalancerName = 'lbi-${compName}-${rg}-${env}'
var frontendIPConfigurationName = 'feic-${compName}-${rg}-${env}'
var backendAddressPoolName = 'bep-${compName}-${vm}-${env}'
var loadBalancingRuleName = 'lbr-${compName}-${vm}-${env}'

var privateLinkServiceName = 'pls-${compName}-${rg}-${env}'
var autoApprovalSubscriptions array = []
var visibilitySubscriptions array = []

var withPorts bool = frontendPort != -1 && backendPort != -1 && probeName != '' && probePort != -1

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
  sku: {
    name: 'Standard'
    tier: 'Regional'
  }
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
    loadBalancingRules: (withPorts
      ? [
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
      : [])
    probes: (withPorts
      ? [
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
      : [])
  }
}

resource privateLinkService 'Microsoft.Network/privateLinkServices@2024-10-01' = {
  name: privateLinkServiceName
  location: location
  properties: {
    enableProxyProtocol: false
    loadBalancerFrontendIpConfigurations: [
      {
        id: loadBalancer.properties.frontendIPConfigurations[0].id
      }
    ]
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: subnet.id
          }
          primary: true
          privateIPAddressVersion: 'IPv4'
        }
      }
    ]
    autoApproval: {
      subscriptions: autoApprovalSubscriptions
    }
    visibility: {
      subscriptions: visibilitySubscriptions
    }
  }
}
