@description('Basename / Prefix of all resources')
param baseName string

// Define names
var storageAccountName = replace('st-dfx-${baseName}', '-', '')
var fileShareName = 'frankencoin-ponder-app'

// Read existing resources
resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource fileService 'Microsoft.Storage/storageAccounts/fileServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
}

resource fileShare 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-05-01' = {
  parent: fileService
  name: fileShareName
  properties: {
    accessTier: 'TransactionOptimized'
    shareQuota: 1
    enabledProtocols: 'SMB'
  }
}

output storageAccountName string = storageAccountName
output fileShareName string = fileShareName
output storageAccountId string = storageAccount.id
