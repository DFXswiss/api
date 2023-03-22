// --- PARAMETERS --- //
param location string
param env string
param network string
param knownIps string
param limitCheck string
param bsLink string


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
param intWalletAddress string
param utxoSpenderAddress string
param btcOutWalletAddress string

@secure()
param evmEncryptionKey string
param ethWalletAddress string
@secure()
param ethWalletPrivateKey string
param ethGatewayUrl string
@secure()
param ethApiKey string
param ethChainId string
param ethSwapContractAddress string
param ethSwapTokenAddress string
param ethScanApiUrl string
@secure()
param ethScanApiKey string

param optimismWalletAddress string
@secure()
param optimismWalletPrivateKey string
param optimismGatewayUrl string
@secure()
param optimismApiKey string
param optimismChainId string
param optimismSwapContractAddress string
param optimismSwapTokenAddress string
param optimismScanApiUrl string
@secure()
param optimismScanApiKey string

param arbitrumWalletAddress string
@secure()
param arbitrumWalletPrivateKey string
param arbitrumGatewayUrl string
@secure()
param arbitrumApiKey string
param arbitrumSwapContractAddress string
param arbitrumSwapTokenAddress string
param arbitrumScanApiUrl string
@secure()
param arbitrumScanApiKey string

param bscWalletAddress string
@secure()
param bscWalletPrivateKey string
param bscGatewayUrl string
param bscSwapContractAddress string
param bscSwapTokenAddress string
param bscScanApiUrl string
@secure()
param bscScanApiKey string

param buyCryptoFeeLimit string

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
@secure()
param binanceEthereumWalletWithdrawKey string


param olkyClient string
@secure()
param olkySecret string
param olkyUser string
@secure()
param olkyPassword string

param frickUrl string
@secure()
param frickKey string
@secure()
param frickPassword string
@secure()
param frickPrivateKey string

param letterUrl string
param letterUser string
@secure()
param letterAuth string

param fixerUrl string
@secure()
param fixerApiKey string

param sepaToolsUser string
@secure()
param sepaToolsPassword string

param btcVmUser string
@secure()
param btcVmPassword string

@secure()
param chainalysisApiKey string

param myDeFiChainUser string
@secure()
param myDeFiChainPassword string

param paymentUrl string

@secure()
param lockApiKey string

param limitRequestSupportBanner string
param limitRequestSupportMail string
param limitRequestSupportName string

param azureSubscriptionId string
param azureTenantId string
param azureClientId string
@secure()
param azureClientSecret string

@secure()
param taliumApiKey string

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'
var nodeName = 'node'

var virtualNetName = 'vnet-${compName}-${apiName}-${env}'
var subNetName = 'snet-${compName}-${apiName}-${env}'
var vmSubNetName = 'snet-${compName}-vm-${env}'
var vmNsgName = 'nsg-${compName}-vm-${env}'

var storageAccountName = replace('st-${compName}-${apiName}-${env}', '-', '')
var dbBackupContainerName = 'db-bak'

var sqlServerName = 'sql-${compName}-${apiName}-${env}'
var sqlDbName = 'sqldb-${compName}-${apiName}-${env}'

var apiServicePlanName = 'plan-${compName}-${apiName}-${env}'
var apiAppName = 'app-${compName}-${apiName}-${env}'
var appInsightsName = 'appi-${compName}-${apiName}-${env}'

var nodeProps = [
  {
    name: 'nodes-input-${env}'
    servicePlanName: 'plan-${compName}-${nodeName}-inp-${env}'
    appName: 'app-${compName}-${nodeName}-inp-${env}'
    fileShareNameA: 'node-inp-data-a'
    fileShareNameB: 'node-inp-data-b'
  }
  {
    name: 'nodes-dex-${env}'
    servicePlanName: 'plan-${compName}-${nodeName}-dex-${env}'
    appName: 'app-${compName}-${nodeName}-dex-${env}'
    fileShareNameA: 'node-dex-data-a'
    fileShareNameB: 'node-dex-data-b'
  }
  {
    name: 'nodes-output-${env}'
    servicePlanName: 'plan-${compName}-${nodeName}-out-${env}'
    appName: 'app-${compName}-${nodeName}-out-${env}'
    fileShareNameA: 'node-out-data-a'
    fileShareNameB: 'node-out-data-b'
  }
  {
    name: 'nodes-int-${env}'
    servicePlanName: 'plan-${compName}-${nodeName}-int-${env}'
    appName: 'app-${compName}-${nodeName}-int-${env}'
    fileShareNameA: 'node-int-data-a'
    fileShareNameB: 'node-int-data-b'
  }
  {
    name: 'nodes-ref-${env}'
    servicePlanName: 'plan-${compName}-${nodeName}-ref-${env}'
    appName: 'app-${compName}-${nodeName}-ref-${env}'
    fileShareNameA: 'node-ref-data-a'
    fileShareNameB: 'node-ref-data-b'
  }
]

var btcNodeProps = [
  {
    name: 'btc-node-input-${env}'
    pipName: 'ip-${compName}-btc-inp-${env}'
    vmName: 'vm-${compName}-btc-inp-${env}'
    vmDiskName: 'osdisk-${compName}-btc-inp-${env}'
    nicName: 'nic-${compName}-btc-inp-${env}'
  }
  {
    name: 'btc-node-output-${env}'
    pipName: 'ip-${compName}-btc-out-${env}'
    vmName: 'vm-${compName}-btc-out-${env}'
    vmDiskName: 'osdisk-${compName}-btc-out-${env}'
    nicName: 'nic-${compName}-btc-out-${env}'
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
          networkSecurityGroup: {
            id: vmNsg.id
          }
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
          name: 'BS_LINK'
          value: bsLink
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
          value: btcNodes[0].outputs.url
        }
        {
          name: 'NODE_BTC_OUT_URL_ACTIVE'
          value: btcNodes[1].outputs.url
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
          name: 'INT_WALLET_ADDRESS'
          value: intWalletAddress
        }
        {
          name: 'UTXO_SPENDER_ADDRESS'
          value: utxoSpenderAddress
        }
        {
          name: 'EVM_ENCRYPTION_KEY'
          value: evmEncryptionKey
        }
        {
          name: 'ETH_WALLET_ADDRESS'
          value: ethWalletAddress
        }
        {
          name: 'ETH_WALLET_PRIVATE_KEY'
          value: ethWalletPrivateKey
        }
        {
          name: 'ETH_GATEWAY_URL'
          value: ethGatewayUrl
        }
        {
          name: 'ETH_API_KEY'
          value: ethApiKey
        }
        {
          name: 'ETH_CHAIN_ID'
          value: ethChainId
        }
        {
          name: 'ETH_SWAP_CONTRACT_ADDRESS'
          value: ethSwapContractAddress
        }
        {
          name: 'ETH_SWAP_TOKEN_ADDRESS'
          value: ethSwapTokenAddress
        }
        {
          name: 'ETH_SCAN_API_URL'
          value: ethScanApiUrl
        }
        {
          name: 'ETH_SCAN_API_KEY'
          value: ethScanApiKey
        }
        {
          name: 'OPTIMISM_WALLET_ADDRESS'
          value: optimismWalletAddress
        }
        {
          name: 'OPTIMISM_WALLET_PRIVATE_KEY'
          value: optimismWalletPrivateKey
        }
        {
          name: 'OPTIMISM_GATEWAY_URL'
          value: optimismGatewayUrl
        }
        {
          name: 'OPTIMISM_API_KEY'
          value: optimismApiKey
        }
        {
          name: 'OPTIMISM_CHAIN_ID'
          value: optimismChainId
        }
        {
          name: 'OPTIMISM_SWAP_CONTRACT_ADDRESS'
          value: optimismSwapContractAddress
        }
        {
          name: 'OPTIMISM_SWAP_TOKEN_ADDRESS'
          value: optimismSwapTokenAddress
        }
        {
          name: 'OPTIMISM_SCAN_API_URL'
          value: optimismScanApiUrl
        }
        {
          name: 'OPTIMISM_SCAN_API_KEY'
          value: optimismScanApiKey
        }
        {
          name: 'ARBITRUM_WALLET_ADDRESS'
          value: arbitrumWalletAddress
        }
        {
          name: 'ARBITRUM_WALLET_PRIVATE_KEY'
          value: arbitrumWalletPrivateKey
        }
        {
          name: 'ARBITRUM_GATEWAY_URL'
          value: arbitrumGatewayUrl
        }
        {
          name: 'ARBITRUM_API_KEY'
          value: arbitrumApiKey
        }
        {
          name: 'ARBITRUM_SWAP_CONTRACT_ADDRESS'
          value: arbitrumSwapContractAddress
        }
        {
          name: 'ARBITRUM_SWAP_TOKEN_ADDRESS'
          value: arbitrumSwapTokenAddress
        }
        {
          name: 'ARBITRUM_SCAN_API_URL'
          value: arbitrumScanApiUrl
        }
        {
          name: 'ARBITRUM_SCAN_API_KEY'
          value: arbitrumScanApiKey
        }
        {
          name: 'BSC_WALLET_ADDRESS'
          value: bscWalletAddress
        }
        {
          name: 'BSC_WALLET_PRIVATE_KEY'
          value: bscWalletPrivateKey
        }
        {
          name: 'BSC_GATEWAY_URL'
          value: bscGatewayUrl
        }
        {
          name: 'BSC_SWAP_CONTRACT_ADDRESS'
          value: bscSwapContractAddress
        }
        {
          name: 'BSC_SWAP_TOKEN_ADDRESS'
          value: bscSwapTokenAddress
        }
        {
          name: 'BSC_SCAN_API_URL'
          value: bscScanApiUrl
        }
        {
          name: 'BSC_SCAN_API_KEY'
          value: bscScanApiKey
        }
        {
          name: 'BTC_OUT_WALLET_ADDRESS'
          value: btcOutWalletAddress
        }
        {
          name: 'BUY_CRYPTO_FEE_LIMIT'
          value: buyCryptoFeeLimit
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
          name: 'BINANCE_ETHEREUM_WALLET_WITHDRAW_KEY'
          value: binanceEthereumWalletWithdrawKey
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
          name: 'FIXER_BASE_URL'
          value: fixerUrl
        }
        {
          name: 'FIXER_API_KEY'
          value: fixerApiKey
        }
        {
          name: 'SEPA_TOOLS_USER'
          value: sepaToolsUser
        }
        {
          name: 'SEPA_TOOLS_PASSWORD'
          value: sepaToolsPassword
        }
        {
          name: 'OLKY_CLIENT'
          value: olkyClient
        }
        {
          name: 'OLKY_CLIENT_SECRET'
          value: olkySecret
        }
        {
          name: 'OLKY_USERNAME'
          value: olkyUser
        }
        {
          name: 'OLKY_PASSWORD'
          value: olkyPassword
        }
        {
          name: 'FRICK_URL'
          value: frickUrl
        }
        {
          name: 'FRICK_KEY'
          value: frickKey
        }
        {
          name: 'FRICK_PASSWORD'
          value: frickPassword
        }
        {
          name: 'FRICK_PRIVATE_KEY'
          value: frickPrivateKey
        }
        {
          name: 'CHAINALYSIS_API_KEY'
          value: chainalysisApiKey
        }
        {
          name: 'MYDEFICHAIN_USER'
          value: myDeFiChainUser
        }
        {
          name: 'MYDEFICHAIN_PASSWORD'
          value: myDeFiChainPassword
        }
        {
          name: 'PAYMENT_URL'
          value: paymentUrl
        }
        {
          name: 'LOCK_API_KEY'
          value: lockApiKey
        }
        {
          name: 'LIMIT_REQUEST_SUPPORT_BANNER'
          value: limitRequestSupportBanner
        }
        {
          name: 'LIMIT_REQUEST_SUPPORT_MAIL'
          value: limitRequestSupportMail
        }
        {
          name: 'LIMIT_REQUEST_SUPPORT_NAME'
          value: limitRequestSupportName
        }
        {
          name: 'AZURE_SUBSCRIPTION_ID'
          value: azureSubscriptionId
        }
        {
          name: 'AZURE_TENANT_ID'
          value: azureTenantId
        }
        {
          name: 'AZURE_CLIENT_ID'
          value: azureClientId
        }
        {
          name: 'AZURE_CLIENT_SECRET'
          value: azureClientSecret
        }
        {
          name: 'TALIUM_API_KEY'
          value: taliumApiKey
        }
        {
          name: 'REQUEST_KNOWN_IPS'
          value: knownIps
        }
        {
          name: 'REQUEST_LIMIT_CHECK'
          value: limitCheck
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
resource vmNsg 'Microsoft.Network/networkSecurityGroups@2020-11-01' = {
  name: vmNsgName
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
  parent: vmNsg
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

module btcNodes 'btc-node.bicep' = [for node in btcNodeProps: {
  name: node.name
  params: {
    location: location
    pipName: node.pipName
    vmName: node.vmName
    vmDiskName: node.vmDiskName
    nicName: node.nicName
    vmUser: btcVmUser
    vmPassword: btcVmPassword
    subnetId: virtualNet.properties.subnets[1].id
  }
}]
