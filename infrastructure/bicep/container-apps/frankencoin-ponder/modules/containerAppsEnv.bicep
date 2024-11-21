@description('Basename / Prefix of all resources')
param baseName string

@description('Name of the storage account')
param storageAccountName string

@description('Name of the file share')
param fileShareName string

// Define names
var environmentName = '${baseName}-aca-env'
var storageName = 'fileshare-frankencoin-ponder'

// Read existing resources
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

// Container Apps Environment Storage
resource environmentStorages 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: environment
  name: storageName
  properties: {
    azureFile: {
      accountName: storageAccountName
      accountKey: storageAccount.listKeys().keys[0].value
      shareName: fileShareName
      accessMode: 'ReadWrite'
    }
  }
}

output containerAppsEnvironmentId string = environment.id
output containerAppsEnvironmentStaticIp string = environment.properties.staticIp
output containerAppsEnvironmentDefaultDomain string = environment.properties.defaultDomain

output storageName string = storageName
