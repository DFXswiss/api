// --- PARAMETERS --- //
@description('Name of the storage account')
param storageAccountName string

@description('Name of the file share')
param fileShareName string

@description('Quota of the file share')
param fileShareQuota int

// --- EXISTING RESOURCES --- //
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

// --- RESOURCES --- //
resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    accessTier: 'TransactionOptimized'
    shareQuota: fileShareQuota
    enabledProtocols: 'SMB'
  }
}
// --- OUTPUT --- //
output storageAccountId string = storageAccount.id
