// --- PARAMETERS --- //
param location string

param servicePlanName string
param servicePlanSkuName string
param servicePlanSkuTier string
param appName string

param subnetId string

param storageAccountName string
param storageAccountId string
param fileShareNameA string
param fileShareNameB string

param allowAllIps bool

param hasBackup bool


// --- RESOURCES --- //
resource fileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccountName}/default/${fileShareNameA}'
}

resource fileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccountName}/default/${fileShareNameB}'
}

resource appServicePlan 'Microsoft.Web/serverfarms@2018-02-01' = {
  name: servicePlanName
  location: location
  kind: 'linux'
  properties: {
      reserved: true
  }
  sku: {
    name: servicePlanSkuName
    tier: servicePlanSkuTier
    capacity: 1
  }
}

resource nodeAppService 'Microsoft.Web/sites@2021-01-15' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true

    siteConfig: {
      alwaysOn: true
      httpLoggingEnabled: true
      logsDirectorySizeLimit: 100
      ipSecurityRestrictions: allowAllIps ? [] : [
        {
          vnetSubnetResourceId: subnetId
          action: 'Allow'
          tag: 'Default'
          priority: 100
          name: 'Allow VNet'
          description: 'Allow all from VNet'
        }
      ]
      scmIpSecurityRestrictionsUseMain: true
      azureStorageAccounts: {
        'node-data': {
          type: 'AzureFiles'
          accountName: storageAccountName
          shareName: fileShareNameA
          mountPath: '/data'
          accessKey: listKeys(storageAccountId, '2021-04-01').keys[0].value
        }
      }
      appSettings: [
        {
          name: 'WEBSITE_ADD_SITENAME_BINDINGS_IN_APPHOST_CONFIG'
          value: '1'
        }
      ]
    }
  }
}
resource nodeStgAppService 'Microsoft.Web/sites/slots@2021-01-15' = if (hasBackup) {
  parent: nodeAppService
  name: 'stg'
  location: location
  kind: 'app,linux,container'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true

    siteConfig: {
      alwaysOn: true
      httpLoggingEnabled: true
      logsDirectorySizeLimit: 100
      ipSecurityRestrictions: allowAllIps ? [] : [
        {
          vnetSubnetResourceId: subnetId
          action: 'Allow'
          tag: 'Default'
          priority: 100
          name: 'Allow VNet'
          description: 'Allow all from VNet'
        }
      ]
      scmIpSecurityRestrictionsUseMain: true
      azureStorageAccounts: {
        'node-data': {
          type: 'AzureFiles'
          accountName: storageAccountName
          shareName: fileShareNameB
          mountPath: '/data'
          accessKey: listKeys(storageAccountId, '2021-04-01').keys[0].value
        }
      }
      appSettings: [
        {
          name: 'WEBSITE_ADD_SITENAME_BINDINGS_IN_APPHOST_CONFIG'
          value: '1'
        }
      ]
    }
  }
}

output url string = 'https://${nodeAppService.properties.defaultHostName}'
output urlStg string = hasBackup ? 'https://${nodeStgAppService.properties.defaultHostName}' : ''
