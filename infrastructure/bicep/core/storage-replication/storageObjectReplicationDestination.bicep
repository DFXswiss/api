// --- PARAMETERS --- //
@description('Name of the destination storage account')
param destinationStorageAccountName string

@description('Resource ID of the source storage account')
param sourceStorageAccountId string

@description('Container rules for replication')
param containerRules array = [
  { sourceContainer: 'db-bak', destinationContainer: 'db-bak' }
  { sourceContainer: 'kyc', destinationContainer: 'kyc' }
  { sourceContainer: 'support', destinationContainer: 'support' }
]

// --- EXISTING RESOURCES --- //
resource destinationStorageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: destinationStorageAccountName
}

// --- RESOURCES --- //
resource destinationReplicationPolicy 'Microsoft.Storage/storageAccounts/objectReplicationPolicies@2023-01-01' = {
  parent: destinationStorageAccount
  name: 'default'
  properties: {
    sourceAccount: sourceStorageAccountId
    destinationAccount: destinationStorageAccount.id
    rules: [for rule in containerRules: {
      sourceContainer: rule.sourceContainer
      destinationContainer: rule.destinationContainer
      filters: contains(rule, 'prefixMatch') ? {
        prefixMatch: rule.prefixMatch
      } : null
    }]
  }
}

// --- OUTPUT --- //
// Die Policy-ID wird aus der Resource-ID extrahiert (letztes Segment = generierte GUID)
output policyId string = last(split(destinationReplicationPolicy.id, '/'))
output destinationStorageAccountId string = destinationStorageAccount.id
