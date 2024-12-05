// --- PARAMETERS --- //
@description('Name of the container app environment')
param environmentName string

@description('Name of the container app environment storage')
param environmentStorageName string

@description('Name of the storage account')
param storageAccountName string

@description('Name of the file share')
param fileShareName string

// --- EXISTING RESOURCES --- //
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// --- RESOURCES --- //
resource environmentStorages 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: environmentStorageName
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

// --- OUTPUT --- //
output containerAppsEnvironmentId string = environment.id
output containerAppsEnvironmentStaticIp string = environment.properties.staticIp
output containerAppsEnvironmentDefaultDomain string = environment.properties.defaultDomain
