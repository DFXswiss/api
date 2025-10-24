// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the company')
param compName string

@description('Deployment environment')
param env string

@description('Name of the resource group')
param rg string

@description('Name of the VM')
param vm string

@description('Profile of the VM hardware')
param hardwareProfile string

@description('Disk size in GB')
param diskSizeGB int

param vmUser string
@secure()
param vmPassword string

// --- VARIABLES --- //
var pipName = 'ip-${compName}-${vm}-${env}'
var vmName = 'vm-${compName}-${vm}-${env}'
var vmDiskName = 'osdisk-${compName}-${vm}-${env}'
var nicName = 'nic-${compName}-${vm}-${env}'

var vnetName = 'vnet-${compName}-${rg}-${env}'

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
      vmSize: hardwareProfile
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
        diskSizeGB: diskSizeGB
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
