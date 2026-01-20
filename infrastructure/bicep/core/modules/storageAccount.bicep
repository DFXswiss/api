// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the storage account')
param storageAccountName string

@description('SKU for the storage account')
@allowed(['Standard_LRS', 'Standard_GRS', 'Standard_ZRS'])
param skuName string = 'Standard_LRS'

@description('Enable blob versioning (required for object replication)')
param enableVersioning bool = true

@description('Enable change feed (required for object replication)')
param enableChangeFeed bool = true

@description('Container names to create')
param containerNames array = [
  'kyc'
  'support'
]

// --- RESOURCES --- //
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: skuName
  }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
  }
}

resource blobServices 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    isVersioningEnabled: enableVersioning
    changeFeed: {
      enabled: enableChangeFeed
    }
  }
}

resource containers 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = [
  for containerName in containerNames: {
    parent: blobServices
    name: containerName
    properties: {
      publicAccess: 'None'
    }
  }
]

// --- OUTPUT --- //
output storageAccountId string = storageAccount.id
output storageAccountName string = storageAccount.name
output primaryBlobEndpoint string = storageAccount.properties.primaryEndpoints.blob
