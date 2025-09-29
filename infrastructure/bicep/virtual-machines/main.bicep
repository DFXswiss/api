// --- PARAMETERS --- //
param location string
param env string

param vmUser string
@secure()
param vmPassword string

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'
var nodeName = 'node'

var pipName = 'ip-${compName}-${nodeName}-${env}'
var vmName = 'vm-${compName}-${nodeName}-${env}'
var vmDiskName = 'osdisk-${compName}-${nodeName}-${env}'
var nicName = 'nic-${compName}-${nodeName}-${env}'

var vnetName = 'vnet-${compName}-${apiName}-${env}'

// --- EXISTING RESOURCES --- //
resource virtualNetworks 'Microsoft.Network/virtualNetworks@2024-07-01' existing = {
  name: vnetName
}

// --- RESOURCES --- //
resource publicIPAddresses 'Microsoft.Network/publicIPAddresses@2024-07-01' = {
  name: pipName
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: vmName
    }
  }
}

resource networkInterfaces 'Microsoft.Network/networkInterfaces@2024-07-01' = {
  name: nicName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: {
            id: publicIPAddresses.id
          }
          subnet: {
            id: virtualNetworks.properties.subnets[1].id
          }
        }
      }
    ]
  }
}

resource virtualMachines 'Microsoft.Compute/virtualMachines@2024-11-01' = {
  name: vmName
  location: location
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_B4ms'
    }
    storageProfile: {
      imageReference: {
        publisher: 'canonical'
        offer: 'ubuntu-24_04-lts'
        sku: 'server'
        version: 'latest'
      }
      osDisk: {
        name: vmDiskName
        createOption: 'FromImage'
        caching: 'ReadWrite'
        managedDisk: {
          storageAccountType: 'Premium_LRS'
        }
        diskSizeGB: 2048
      }
    }
    osProfile: {
      computerName: vmName
      adminUsername: vmUser
      adminPassword: vmPassword
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: networkInterfaces.id
        }
      ]
    }
    diagnosticsProfile: {
      bootDiagnostics: {
        enabled: true
      }
    }
  }
}

output ip string = networkInterfaces.properties.ipConfigurations[0].properties.privateIPAddress
