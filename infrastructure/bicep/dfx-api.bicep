// --- PARAMETERS --- //
param location string
param env string

param dbAllowAllIps bool
param dbAdminLogin string
@secure()
param dbAdminPassword string
param dbTier string
param dbCapacity int

@secure()
param jwtSecret string = newGuid()

@secure()
param mailClientSecret string
@secure()
param mailRefreshToken string

param kycMandator string
@secure()
param kycPassword string
param kycPrefix string

@secure()
param githubToken string

param nodeAllowAllIps bool
@secure()
param nodePassword string
@secure()
param nodeWalletPassword string
param dexWalletAddress string
param stakingWalletAddress string
param utxoSpenderAddress string

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


// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'
var nodeName = 'node'

var virtualNetName = 'vnet-${compName}-${apiName}-${env}'
var subNetName = 'snet-${compName}-${apiName}-${env}'

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
    ]
  }
}


// Storage Account
// TODO: VNet integration
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
          name: 'SIGN_MESSAGE'
          value: 'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_DeFiChain_address_and_are_in_possession_of_its_private_key._Your_ID:_'
        }
        {
          name: 'SIGN_MESSAGE_WALLET'
          value: 'By_signing_this_message,_you_confirm_that_you_are_the_sole_owner_of_the_provided_DeFiChain_address_and_are_in_possession_of_its_private_key._Your_ID:_'
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
          value: 'noreply@dfx.swiss'
        }
        {
          name: 'MAIL_CLIENT_ID'
          value: '578506515534-apbuebtmlc7eu8voept7ad7k74njcact.apps.googleusercontent.com'
        }
        {
          name: 'MAIL_CLIENT_SECRET'
          value: mailClientSecret
        }
        {
          name: 'MAIL_REFRESH_TOKEN'
          value: mailRefreshToken
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
          name: 'DEX_WALLET_ADDRESS'
          value: dexWalletAddress
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
