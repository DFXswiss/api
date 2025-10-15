// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the virtual network')
param virtualNetworkName string

@description('Name of the db server')
param sqlServerName string

@description('Name of the db')
param sqlDbName string

@description('DB parameters')
param dbAllowAllIps bool
param dbAdminLogin string
@secure()
param dbAdminPassword string
param dbTier string
param dbCapacity int

// --- EXISTING RESOURCES --- //
resource virtualNetwork 'Microsoft.Network/virtualNetworks@2024-10-01' existing = {
  name: virtualNetworkName
}

// --- RESOURCES --- //
resource sqlServer 'Microsoft.Sql/servers@2021-02-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: dbAdminLogin
    administratorLoginPassword: dbAdminPassword
  }
}

resource sqlVirtualNetworkRule 'Microsoft.Sql/servers/virtualNetworkRules@2023-08-01' = {
  parent: sqlServer
  name: 'apiVNetRule'
  properties: {
    virtualNetworkSubnetId: virtualNetwork.properties.subnets[0].id
  }
}

resource sqlFirewallRules 'Microsoft.Sql/servers/firewallRules@2023-08-01' = if (dbAllowAllIps) {
  parent: sqlServer
  name: 'all'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '255.255.255.255'
  }
}

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01' = {
  parent: sqlServer
  name: sqlDbName
  location: location
  sku: {
    name: dbTier
    tier: dbTier
    capacity: dbCapacity
  }
}

resource sqlDbStrPolicy 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2023-08-01' = {
  parent: sqlDatabase
  name: 'default'
  properties: {
    retentionDays: dbTier == 'Basic' ? 7 : 35
    diffBackupIntervalInHours: 24
  }
}

resource sqlDbLtrPolicy 'Microsoft.Sql/servers/databases/backupLongTermRetentionPolicies@2023-08-01' = {
  parent: sqlDatabase
  name: 'default'
  properties: {
    weeklyRetention: 'P5W'
    monthlyRetention: 'P12M'
    yearlyRetention: 'P10Y'
    weekOfYear: 1
  }
}
