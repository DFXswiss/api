// --- PARAMETERS --- //
param location string
param env string
param network string

param dbAllowAllIps bool
param dbAdminLogin string
@secure()
param dbAdminPassword string
param dbTier string
param dbCapacity int

@secure()
param jwtSecret string = newGuid()

param mailUser string
@secure()
param mailPass string

param kycMandator string
@secure()
param kycPassword string
param kycPrefix string
param kycWebhookIps string

@secure()
param githubToken string

param nodeAllowAllIps bool
param allowedIpRange string
@secure()
param nodePassword string
@secure()
param nodeWalletPassword string
param dexWalletAddress string
param outWalletAddress string
param stakingWalletAddress string
param utxoSpenderAddress string
param btcCollectorAddress string

param nodeServicePlanSkuName string
param nodeServicePlanSkuTier string
param hasBackupNodes bool

@secure()
param ftpPassword string
param ftpFolder string

@secure()
param krakenKey string
@secure()
param krakenSecret string

@secure()
param binanceKey string
@secure()
param binanceSecret string

param letterUrl string
param letterUser string
@secure()
param letterAuth string

param sepaToolsUser string
@secure()
param sepaToolsPassword string

param btcVmUser string
@secure()
param btcVmPassword string


// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'
var nodeName = 'node'

var virtualNetName = 'vnet-${compName}-${apiName}-${env}'
var subNetName = 'snet-${compName}-${apiName}-${env}'
var vmSubNetName = 'snet-${compName}-vm-${env}'

var storageAccountName = replace('st-${compName}-${apiName}-${env}', '-', '')
var dbBackupContainerName = 'db-bak'
var nodeInpFileShareNameA = 'node-inp-data-a'
var nodeInpFileShareNameB = 'node-inp-data-b'
var nodeDexFileShareNameA = 'node-dex-data-a'
var nodeDexFileShareNameB = 'node-dex-data-b'
var nodeOutFileShareNameA = 'node-out-data-a'
var nodeOutFileShareNameB = 'node-out-data-b'
var nodeIntFileShareNameA = 'node-int-data-a'
var nodeIntFileShareNameB = 'node-int-data-b'
var nodeRefFileShareNameA = 'node-ref-data-a'
var nodeRefFileShareNameB = 'node-ref-data-b'

var sqlServerName = 'sql-${compName}-${apiName}-${env}'
var sqlDbName = 'sqldb-${compName}-${apiName}-${env}'

var apiServicePlanName = 'plan-${compName}-${apiName}-${env}'
var apiAppName = 'app-${compName}-${apiName}-${env}'
var appInsightsName = 'appi-${compName}-${apiName}-${env}'

var nodeInpServicePlanName = 'plan-${compName}-${nodeName}-inp-${env}'
var nodeInpAppName = 'app-${compName}-${nodeName}-inp-${env}'
var nodeDexServicePlanName = 'plan-${compName}-${nodeName}-dex-${env}'
var nodeDexAppName = 'app-${compName}-${nodeName}-dex-${env}'
var nodeOutServicePlanName = 'plan-${compName}-${nodeName}-out-${env}'
var nodeOutAppName = 'app-${compName}-${nodeName}-out-${env}'
var nodeIntServicePlanName = 'plan-${compName}-${nodeName}-int-${env}'
var nodeIntAppName = 'app-${compName}-${nodeName}-int-${env}'
var nodeRefServicePlanName = 'plan-${compName}-${nodeName}-ref-${env}'
var nodeRefAppName = 'app-${compName}-${nodeName}-ref-${env}'

var btcVmName = 'vm-${compName}-btc-inp-${env}'
var btcVmDiskName = 'osdisk-${compName}-btc-inp-${env}'
var btcNicName = 'nic-${compName}-btc-inp-${env}'
var btcPipName = 'ip-${compName}-btc-inp-${env}'
var btcNsgName = 'nsg-${compName}-btc-inp-${env}'


var nodeProps = [
  {
    name: 'nodes-input-${env}'
    servicePlanName: nodeInpServicePlanName
    appName: nodeInpAppName
    fileShareNameA: nodeInpFileShareNameA
    fileShareNameB: nodeInpFileShareNameB
  }
  {
    name: 'nodes-dex-${env}'
    servicePlanName: nodeDexServicePlanName
    appName: nodeDexAppName
    fileShareNameA: nodeDexFileShareNameA
    fileShareNameB: nodeDexFileShareNameB
  }
  {
    name: 'nodes-output-${env}'
    servicePlanName: nodeOutServicePlanName
    appName: nodeOutAppName
    fileShareNameA: nodeOutFileShareNameA
    fileShareNameB: nodeOutFileShareNameB
  }
  {
    name: 'nodes-int-${env}'
    servicePlanName: nodeIntServicePlanName
    appName: nodeIntAppName
    fileShareNameA: nodeIntFileShareNameA
    fileShareNameB: nodeIntFileShareNameB
  }
  {
    name: 'nodes-ref-${env}'
    servicePlanName: nodeRefServicePlanName
    appName: nodeRefAppName
    fileShareNameA: nodeRefFileShareNameA
    fileShareNameB: nodeRefFileShareNameB
  }
]

// --- RESOURCES --- //

// Virtual Network
resource virtualNet 'Microsoft.Network/virtualNetworks@2020-11-01' = {
  name: virtualNetName
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.0.0.0/16'
      ]
    }
    subnets: [
      {
        name: subNetName
        properties: {
          addressPrefix: '10.0.0.0/24'
          serviceEndpoints: [
            {
              service: 'Microsoft.Web'
              locations: [
                '*'
              ]
            }
            {
              service: 'Microsoft.Sql'
              locations: [
                '*'
              ]
            }
          ]
          delegations: [
            {
              name: '0'
              properties: {
                serviceName: 'Microsoft.Web/serverFarms'
              }
            }
          ]
          privateEndpointNetworkPolicies: 'Enabled'
          privateLinkServiceNetworkPolicies: 'Enabled'
        }
      }
      {
        name: vmSubNetName
        properties: {
          addressPrefix: '10.0.1.0/24'
        }
      }
    ]
  }
}


// Storage Account
resource storageAccount 'Microsoft.Storage/storageAccounts@2021-04-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    allowBlobPublicAccess: false
    allowSharedKeyAccess: true
    supportsHttpsTrafficOnly: true
    accessTier: 'Hot'
  }
}

resource dbBackupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-04-01' = {
  name: '${storageAccount.name}/default/${dbBackupContainerName}'
}

resource nodeInpFileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeInpFileShareNameA}'
}

resource nodeInpFileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeInpFileShareNameB}'
}

resource nodeDexFileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeDexFileShareNameA}'
}

resource nodeDexFileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeDexFileShareNameB}'
}

resource nodeOutFileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeOutFileShareNameA}'
}

resource nodeOutFileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeOutFileShareNameB}'
}

resource nodeIntFileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeIntFileShareNameA}'
}

resource nodeIntFileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeIntFileShareNameB}'
}

resource nodeRefFileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeRefFileShareNameA}'
}

resource nodeRefFileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeRefFileShareNameB}'
}


// SQL Database
resource sqlServer 'Microsoft.Sql/servers@2021-02-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: dbAdminLogin
    administratorLoginPassword: dbAdminPassword
  }
}

resource sqlVNetRule 'Microsoft.Sql/servers/virtualNetworkRules@2021-02-01-preview' = {
 parent: sqlServer
 name: 'apiVNetRule'
 properties: {
   virtualNetworkSubnetId: virtualNet.properties.subnets[0].id
 }
}

resource sqlAllRule 'Microsoft.Sql/servers/firewallRules@2021-02-01-preview' = if (dbAllowAllIps) {
  parent: sqlServer
  name: 'all'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '255.255.255.255'
  }
}

resource sqlDb 'Microsoft.Sql/servers/databases@2021-02-01-preview' = {
  parent: sqlServer
  name: sqlDbName
  location: location
  sku: {
    name: dbTier
    tier: dbTier
    capacity: dbCapacity
  }
}

resource sqlDbStrPolicy 'Microsoft.Sql/servers/databases/backupShortTermRetentionPolicies@2021-08-01-preview' = {
  parent: sqlDb
  name: 'default'
  properties: {
    retentionDays: dbTier == 'Basic' ? 7 : 35
    diffBackupIntervalInHours: 24
  }
}

resource sqlDbLtrPolicy 'Microsoft.Sql/servers/databases/backupLongTermRetentionPolicies@2021-08-01-preview' = {
  parent: sqlDb
  name: 'default'
  properties: {
    weeklyRetention: 'P5W'
    monthlyRetention: 'P12M'
    yearlyRetention: 'P10Y'
    weekOfYear: 1
  }
}


// API App Service
resource appServicePlan 'Microsoft.Web/serverfarms@2018-02-01' = {
  name: apiServicePlanName
  location: location
  kind: 'linux'
  properties: {
      reserved: true
  }
  sku: {
    name: 'P1v2'
    tier: 'PremiumV2'
    capacity: 1
  }
}

resource apiAppService 'Microsoft.Web/sites@2018-11-01' = {
  name: apiAppName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    virtualNetworkSubnetId: virtualNet.properties.subnets[0].id
    
    siteConfig: {
      alwaysOn: true
      linuxFxVersion: 'NODE|14-lts'
      appCommandLine: 'npm run start:prod'
      httpLoggingEnabled: true
      logsDirectorySizeLimit: 100
      vnetRouteAllEnabled: true
      scmIpSecurityRestrictionsUseMain: true
      
      appSettings: [
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
        }
        {
          name: 'ENVIRONMENT'
          value: env
        }
        {
          name: 'NETWORK'
          value: network
        }
        {
          name: 'SQL_HOST'
          value: sqlServer.properties.fullyQualifiedDomainName
        }
        {
          name: 'SQL_PORT'
          value: '1433'
        }
        {
          name: 'SQL_USERNAME'
          value: dbAdminLogin
        }
        {
          name: 'SQL_PASSWORD'
          value: dbAdminPassword
        }
        {
          name: 'SQL_DB'
          value: sqlDbName
        }
        {
          name: 'JWT_SECRET'
          value: jwtSecret
        }
        {
          name: 'SQL_SYNCHRONIZE'
          value: 'false'
        }
        {
          name: 'SQL_MIGRATE'
          value: 'true'
        }
        {
          name: 'MAIL_USER'
          value: mailUser
        }
        {
          name: 'MAIL_PASS'
          value: mailPass
        }
        {
          name: 'KYC_MANDATOR'
          value: kycMandator
        }
        {
          name: 'KYC_USER'
          value: 'api'
        }
        {
          name: 'KYC_PASSWORD'
          value: kycPassword
        }
        {
          name: 'KYC_PREFIX'
          value: kycPrefix
        }
        {
          name: 'KYC_WEBHOOK_IPS'
          value: kycWebhookIps
        }
        {
          name: 'GH_TOKEN'
          value: githubToken
        }

        {
          name: 'NODE_USER'
          value: 'dfx-api'
        }
        {
          name: 'NODE_PASSWORD'
          value: nodePassword
        }
        {
          name: 'NODE_WALLET_PASSWORD'
          value: nodeWalletPassword
        }
        {
          name: 'NODE_INP_URL_ACTIVE'
          value: nodes[0].outputs.url
        }
        {
          name: 'NODE_INP_URL_PASSIVE'
          value: nodes[0].outputs.urlStg
        }
        {
          name: 'NODE_DEX_URL_ACTIVE'
          value: nodes[1].outputs.url
        }
        {
          name: 'NODE_DEX_URL_PASSIVE'
          value: nodes[1].outputs.urlStg
        }
        {
          name: 'NODE_OUT_URL_ACTIVE'
          value: nodes[2].outputs.url
        }
        {
          name: 'NODE_OUT_URL_PASSIVE'
          value: nodes[2].outputs.urlStg
        }
        {
          name: 'NODE_INT_URL_ACTIVE'
          value: nodes[3].outputs.url
        }
        {
          name: 'NODE_INT_URL_PASSIVE'
          value: nodes[3].outputs.urlStg
        }
        {
          name: 'NODE_REF_URL_ACTIVE'
          value: nodes[4].outputs.url
        }
        {
          name: 'NODE_REF_URL_PASSIVE'
          value: nodes[4].outputs.urlStg
        }
        {
          name: 'NODE_BTC_INP_URL_ACTIVE'
          value: 'http://${btcNic.properties.ipConfigurations[0].properties.privateIPAddress}:8332'
        }
        {
          name: 'DEX_WALLET_ADDRESS'
          value: dexWalletAddress
        }
        {
          name: 'OUT_WALLET_ADDRESS'
          value: outWalletAddress
        }
        {
          name: 'STAKING_WALLET_ADDRESS'
          value: stakingWalletAddress
        }
        {
          name: 'UTXO_SPENDER_ADDRESS'
          value: utxoSpenderAddress
        }
        {
          name: 'BTC_COLLECTOR_ADDRESS'
          value: btcCollectorAddress
        }
        {
          name: 'FTP_HOST'
          value: '138.201.74.234'
        }
        {
          name: 'FTP_USER'
          value: 'Administrator'
        }
        {
          name: 'FTP_PASSWORD'
          value: ftpPassword
        }
        {
          name: 'FTP_FOLDER'
          value: ftpFolder
        }
        {
          name: 'KRAKEN_KEY'
          value: krakenKey
        }
        {
          name: 'KRAKEN_SECRET'
          value: krakenSecret
        }
        {
          name: 'BINANCE_KEY'
          value: binanceKey
        }
        {
          name: 'BINANCE_SECRET'
          value: binanceSecret
        }
        {
          name: 'LETTER_URL'
          value: letterUrl
        }
        {
          name: 'LETTER_USER'
          value: letterUser
        }
        {
          name: 'LETTER_AUTH'
          value: letterAuth
        }
        {
          name: 'SEPA_TOOLS_USER'
          value: sepaToolsUser
        }
        {
          name: 'SEPA_TOOLS_PASSWORD'
          value: sepaToolsPassword
        }
      ]
    }
  }
}

resource appInsights 'microsoft.insights/components@2020-02-02-preview' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    IngestionMode: 'ApplicationInsights'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}


// DeFi Nodes
module nodes 'defi-node.bicep' = [for node in nodeProps: {
  name: node.name
  params: {
    location: location
    servicePlanName: node.servicePlanName
    servicePlanSkuName: nodeServicePlanSkuName
    servicePlanSkuTier: nodeServicePlanSkuTier
    appName: node.appName
    subnetId: virtualNet.properties.subnets[0].id
    storageAccountName: storageAccountName
    storageAccountId: storageAccount.id
    fileShareNameA: node.fileShareNameA
    fileShareNameB: node.fileShareNameB
    allowAllIps: nodeAllowAllIps
    hasBackup: hasBackupNodes
  }
}]


// BTC Node
resource btcPip 'Microsoft.Network/publicIPAddresses@2020-11-01' = {
  name: btcPipName
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: {
      domainNameLabel: btcVmName
    }
  }
}

resource btcNsg 'Microsoft.Network/networkSecurityGroups@2020-11-01' = {
  name: btcNsgName
  location: location
  properties: {
    securityRules: [
      {
        name: 'SSH'
        properties: {
          protocol: 'TCP'
          sourcePortRange: '*'
          destinationPortRange: '22'
          sourceAddressPrefix: allowedIpRange
          destinationAddressPrefix: '*'
          access: 'Allow'
          priority: 300
          direction: 'Inbound'
        }
      }
    ]
  }
}

resource rpcRule 'Microsoft.Network/networkSecurityGroups/securityRules@2020-11-01' = if (nodeAllowAllIps) {
  parent: btcNsg
  name: 'RPC'
  properties: {
    protocol: 'TCP'
    sourcePortRange: '*'
    destinationPortRange: '8332'
    sourceAddressPrefix: allowedIpRange
    destinationAddressPrefix: '*'
    access: 'Allow'
    priority: 350
    direction: 'Inbound'
  }
}

resource btcNic 'Microsoft.Network/networkInterfaces@2020-11-01' = {
  name: btcNicName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: {
            id: btcPip.id
          }
          subnet: {
            id: virtualNet.properties.subnets[1].id
          }
        }
      }
    ]
    networkSecurityGroup: {
      id: btcNsg.id
    }
  }
}

resource btcVm 'Microsoft.Compute/virtualMachines@2022-03-01' = {
  name: btcVmName
  location: location
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_B2s'
    }
    storageProfile: {
      imageReference: {
        publisher: 'canonical'
        offer: '0001-com-ubuntu-server-focal'
        sku: '20_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        name: btcVmDiskName
        createOption: 'FromImage'
        caching: 'ReadWrite'
        managedDisk: {
          storageAccountType: 'StandardSSD_LRS'
        }
        diskSizeGB: 1023
      }
    }
    osProfile: {
      computerName: btcVmName
      adminUsername: btcVmUser
      adminPassword: btcVmPassword
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: btcNic.id
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
