// --- PARAMETERS --- //
@description('Name of the source storage account')
param sourceStorageAccountName string

@description('Resource ID of the destination storage account')
param destinationStorageAccountId string

@description('Policy ID from the destination deployment')
param replicationPolicyId string

@description('Container rules from destination policy (including ruleId)')
param containerRules array

// --- EXISTING RESOURCES --- //
resource sourceStorageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' existing = {
  name: sourceStorageAccountName
}

// --- RESOURCES --- //
resource sourceReplicationPolicy 'Microsoft.Storage/storageAccounts/objectReplicationPolicies@2023-01-01' = {
  parent: sourceStorageAccount
  name: replicationPolicyId
  properties: {
    sourceAccount: sourceStorageAccount.id
    destinationAccount: destinationStorageAccountId
    rules: [for rule in containerRules: {
      ruleId: rule.ruleId
      sourceContainer: rule.sourceContainer
      destinationContainer: rule.destinationContainer
    }]
  }
}

// --- OUTPUT --- //
output replicationPolicyId string = sourceReplicationPolicy.name
