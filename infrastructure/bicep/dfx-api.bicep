// --- PARAMETERS --- //
param location string
param env string
param network string
param oceanUrls string
param knownIps string
param limitCheck string
param bsLink string

param apiSkuName string
param apiSkuTier string

param dbAllowAllIps bool
param dbAdminLogin string
@secure()
param dbAdminPassword string
param dbTier string
param dbCapacity int
param dbPoolMin int
param dbPoolMax int

@secure()
param jwtSecret string = newGuid()

param mailUser string
@secure()
param mailPass string

param kycGatewayHost string
param kycCustomerAuto string
@secure()
param kycApiKeyAuto string
param kycCustomerVideo string
@secure()
param kycApiKeyVideo string
param kycTransactionPrefix string

param kycMandator string
@secure()
param kycPassword string
param kycPrefix string
param kycWebhookIps string

param kycAppToken string
@secure()
param kycSecretKey string
@secure()
param kycWebhookSecret string

@secure()
param githubToken string

param nodeAllowAllIps bool
param allowedIpRange string
@secure()
param nodePassword string
@secure()
param nodeWalletPassword string
param dexWalletAddress string
param utxoSpenderAddress string
param btcOutWalletAddress string

param paymentTimeout string
param paymentQuoteTimeout string
param paymentTimeoutDelay string
@secure()
param paymentEvmSeed string
param paymentMoneroAddress string
param paymentBitcoinAddress string
param paymentCheckbotSignTx string
param paymentCheckbotPubKey string

@secure()
param evmDepositSeed string
param ethWalletAddress string
@secure()
param ethWalletPrivateKey string
param ethGatewayUrl string
param ethSwapContractAddress string
param ethQuoteContractAddress string
param ethChainId string

param optimismWalletAddress string
@secure()
param optimismWalletPrivateKey string
param optimismGatewayUrl string
param optimismSwapContractAddress string
param optimismQuoteContractAddress string
param optimismChainId string

param arbitrumWalletAddress string
@secure()
param arbitrumWalletPrivateKey string
param arbitrumGatewayUrl string
param arbitrumSwapContractAddress string
param arbitrumQuoteContractAddress string
param arbitrumChainId string

param polygonWalletAddress string
@secure()
param polygonWalletPrivateKey string
param polygonGatewayUrl string
param polygonSwapContractAddress string
param polygonQuoteContractAddress string
param polygonChainId string

param baseWalletAddress string
@secure()
param baseWalletPrivateKey string
param baseGatewayUrl string
param baseSwapContractAddress string
param baseQuoteContractAddress string
param baseChainId string

param gnosisWalletAddress string
@secure()
param gnosisWalletPrivateKey string
param gnosisGatewayUrl string
param gnosisSwapContractAddress string
param gnosisQuoteContractAddress string
param gnosisChainId string

param bscWalletAddress string
@secure()
param bscWalletPrivateKey string
param bscGatewayUrl string
param bscSwapContractAddress string
param bscQuoteContractAddress string
param bscChainId string

@secure()
param lightningApiCertificate string
@secure()
param lightningSigningPrivKey string
@secure()
param lightningSigningPubKey string
@secure()
param lightningLnbitsApiKey string
@secure()
param lightningLndAdminMacaroon string

param moneroWalletAddress string
@secure()
param moneroRpcCertificate string

param zchfGraphUrl string
param zchfContractAddress string
param zchfEquityContractAddress string
param zchfStablecoinBridgeContractAddress string
param zchfXchfContractAddress string

param deuroGraphUrl string
param deuroApiUrl string

param ebel2XContractAddress string

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

param krakenWithdrawKeys string
param krakenBtcDepositAddress string
param krakenPolygonDepositAddress string

@secure()
param binanceKey string
@secure()
param binanceSecret string

param binanceWithdrawKeys string
param binanceBtcDepositAddress string
param binanceEvmDepositAddress string

@secure()
param p2bKey string
@secure()
param p2bSecret string

param p2bWithdrawKeys string

param olkyClient string
@secure()
param olkySecret string
param olkyUser string
@secure()
param olkyPassword string

@secure()
param revolutRefreshToken string
@secure()
param revolutClientAssertion string

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
param coinGeckoApiKey string

param paymentUrl string
param servicesUrl string

param limitRequestSupportBanner string
param limitRequestSupportMail string
param limitRequestSupportStaffMail string
param limitRequestSupportName string

param azureSubscriptionId string
param azureTenantId string
param azureClientId string
@secure()
param azureClientSecret string
@secure()
param azureStorageConnectionString string

param albyClientId string
@secure()
param albyClientSecret string

@secure()
param iknaKey string

@secure()
param ckoPublicKey string
@secure()
param ckoSecretKey string
@secure()
param ckoEntityId string

@secure()
param siftApiKey string
@secure()
param siftAccountId string
param siftAnalyst string

param delisenseJsonPath string
@secure()
param delisenseKey string

@secure()
param alchemyApiKey string
@secure()
param alchemyAuthToken string

param customBalanceAssets string
param customBalanceAddresses string

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
var kycDocumentContainerName = 'kyc'

var sqlServerName = 'sql-${compName}-${apiName}-${env}'
var sqlDbName = 'sqldb-${compName}-${apiName}-${env}'

var apiServicePlanName = 'plan-${compName}-${apiName}-${env}'
var apiAppName = 'app-${compName}-${apiName}-${env}'
var appInsightsName = 'appi-${compName}-${apiName}-${env}'

var btcNodePort = '8332'
var lnBitsPort = '5000'
var moneroNodePort = '18081'
var moneroRpcPort = '18082'

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

resource kycDocumentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2021-04-01' = {
  name: '${storageAccount.name}/default/${kycDocumentContainerName}'
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
    name: apiSkuName
    tier: apiSkuTier
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
      linuxFxVersion: 'NODE|16-lts'
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
          name: 'OCEAN_URLS'
          value: oceanUrls
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
          name: 'SQL_POOL_MIN'
          value: dbPoolMin
        }
        {
          name: 'SQL_POOL_MAX'
          value: dbPoolMax
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
          name: 'KYC_GATEWAY_HOST'
          value: kycGatewayHost
        }
        {
          name: 'KYC_CUSTOMER_AUTO'
          value: kycCustomerAuto
        }
        {
          name: 'KYC_API_KEY_AUTO'
          value: kycApiKeyAuto
        }
        {
          name: 'KYC_CUSTOMER_VIDEO'
          value: kycCustomerVideo
        }
        {
          name: 'KYC_API_KEY_VIDEO'
          value: kycApiKeyVideo
        }
        {
          name: 'KYC_TRANSACTION_PREFIX'
          value: kycTransactionPrefix
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
          name: 'KYC_APP_TOKEN'
          value: kycAppToken
        }
        {
          name: 'KYC_SECRET_KEY'
          value: kycSecretKey
        }
        {
          name: 'KYC_WEBHOOK_SECRET'
          value: kycWebhookSecret
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
          name: 'NODE_BTC_INP_URL_ACTIVE'
          value: 'http://${btcNodes[0].outputs.ip}:${btcNodePort}'
        }
        {
          name: 'NODE_BTC_OUT_URL_ACTIVE'
          value: 'http://${btcNodes[1].outputs.ip}:${btcNodePort}'
        }
        {
          name: 'DEX_WALLET_ADDRESS'
          value: dexWalletAddress
        }
        {
          name: 'UTXO_SPENDER_ADDRESS'
          value: utxoSpenderAddress
        }
        {
          name: 'BTC_OUT_WALLET_ADDRESS'
          value: btcOutWalletAddress
        }
        {
          name: 'PAYMENT_TIMEOUT'
          value: paymentTimeout
        }
        {
          name: 'PAYMENT_QUOTE_TIMEOUT'
          value: paymentQuoteTimeout
        }
        {
          name: 'PAYMENT_TIMEOUT_DELAY'
          value: paymentTimeoutDelay
        }
        {
          name: 'PAYMENT_EVM_SEED'
          value: paymentEvmSeed
        }
        {
          name: 'PAYMENT_MONERO_ADDRESS'
          value: paymentMoneroAddress
        }
        {
          name: 'PAYMENT_BITCOIN_ADDRESS'
          value: paymentBitcoinAddress
        }
        {
          name: 'PAYMENT_CHECKBOT_SIGN_TX'
          value: paymentCheckbotSignTx
        }
        {
          name: 'PAYMENT_CHECKBOT_PUB_KEY'
          value: paymentCheckbotPubKey
        }
        {
          name: 'EVM_DEPOSIT_SEED'
          value: evmDepositSeed
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
          name: 'ETH_SWAP_CONTRACT_ADDRESS'
          value: ethSwapContractAddress
        }
        {
          name: 'ETH_QUOTE_CONTRACT_ADDRESS'
          value: ethQuoteContractAddress
        }
        {
          name: 'ETH_CHAIN_ID'
          value: ethChainId
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
          name: 'OPTIMISM_SWAP_CONTRACT_ADDRESS'
          value: optimismSwapContractAddress
        }
        {
          name: 'OPTIMISM_QUOTE_CONTRACT_ADDRESS'
          value: optimismQuoteContractAddress
        }
        {
          name: 'OPTIMISM_CHAIN_ID'
          value: optimismChainId
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
          name: 'ARBITRUM_SWAP_CONTRACT_ADDRESS'
          value: arbitrumSwapContractAddress
        }
        {
          name: 'ARBITRUM_QUOTE_CONTRACT_ADDRESS'
          value: arbitrumQuoteContractAddress
        }
        {
          name: 'ARBITRUM_CHAIN_ID'
          value: arbitrumChainId
        }
        {
          name: 'POLYGON_WALLET_ADDRESS'
          value: polygonWalletAddress
        }
        {
          name: 'POLYGON_WALLET_PRIVATE_KEY'
          value: polygonWalletPrivateKey
        }
        {
          name: 'POLYGON_GATEWAY_URL'
          value: polygonGatewayUrl
        }
        {
          name: 'POLYGON_SWAP_CONTRACT_ADDRESS'
          value: polygonSwapContractAddress
        }
        {
          name: 'POLYGON_QUOTE_CONTRACT_ADDRESS'
          value: polygonQuoteContractAddress
        }
        {
          name: 'POLYGON_CHAIN_ID'
          value: polygonChainId
        }
        {
          name: 'BASE_WALLET_ADDRESS'
          value: baseWalletAddress
        }
        {
          name: 'BASE_WALLET_PRIVATE_KEY'
          value: baseWalletPrivateKey
        }
        {
          name: 'BASE_GATEWAY_URL'
          value: baseGatewayUrl
        }
        {
          name: 'BASE_SWAP_CONTRACT_ADDRESS'
          value: baseSwapContractAddress
        }
        {
          name: 'BASE_QUOTE_CONTRACT_ADDRESS'
          value: baseQuoteContractAddress
        }
        {
          name: 'BASE_CHAIN_ID'
          value: baseChainId
        }
        {
          name: 'GNOSIS_WALLET_ADDRESS'
          value: gnosisWalletAddress
        }
        {
          name: 'GNOSIS_WALLET_PRIVATE_KEY'
          value: gnosisWalletPrivateKey
        }
        {
          name: 'GNOSIS_GATEWAY_URL'
          value: gnosisGatewayUrl
        }
        {
          name: 'GNOSIS_SWAP_CONTRACT_ADDRESS'
          value: gnosisSwapContractAddress
        }
        {
          name: 'GNOSIS_QUOTE_CONTRACT_ADDRESS'
          value: gnosisQuoteContractAddress
        }
        {
          name: 'GNOSIS_CHAIN_ID'
          value: gnosisChainId
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
          name: 'BSC_QUOTE_CONTRACT_ADDRESS'
          value: bscQuoteContractAddress
        }
        {
          name: 'BSC_CHAIN_ID'
          value: bscChainId
        }
        {
          name: 'LIGHTNING_API_CERTIFICATE'
          value: lightningApiCertificate
        }
        {
          name: 'LIGHTNING_SIGNING_PRIV_KEY'
          value: lightningSigningPrivKey
        }
        {
          name: 'LIGHTNING_SIGNING_PUB_KEY'
          value: lightningSigningPubKey
        }
        {
          name: 'LIGHTNING_LNBITS_API_URL'
          value: 'https://${btcNodes[0].outputs.ip}:${lnBitsPort}/api/v1'
        }
        {
          name: 'LIGHTNING_LNBITS_LNURLP_API_URL'
          value: 'https://${btcNodes[0].outputs.ip}:${lnBitsPort}/lnurlp/api/v1'
        }
        {
          name: 'LIGHTNING_LNBITS_API_KEY'
          value: lightningLnbitsApiKey
        }
        {
          name: 'LIGHTNING_LNBITS_LNURLP_URL'
          value: 'https://${btcNodes[0].outputs.ip}:${lnBitsPort}/lnurlp'
        }
        {
          name: 'LIGHTNING_LND_API_URL'
          value: 'https://${btcNodes[0].outputs.ip}:8080/v1'
        }
        {
          name: 'LIGHTNING_LND_ADMIN_MACAROON'
          value: lightningLndAdminMacaroon
        }
        {
          name: 'MONERO_WALLET_ADDRESS'
          value: moneroWalletAddress
        }
        {
          name: 'MONERO_NODE_URL'
          value: 'https://${btcNodes[0].outputs.ip}:${moneroNodePort}'
        }
        {
          name: 'MONERO_RPC_URL'
          value: 'https://${btcNodes[0].outputs.ip}:${moneroRpcPort}'
        }
        {
          name: 'MONERO_RPC_CERTIFICATE'
          value: moneroRpcCertificate
        }
        {
          name: 'ZCHF_GRAPH_URL'
          value: zchfGraphUrl
        }
        {
          name: 'ZCHF_CONTRACT_ADDRESS'
          value: zchfContractAddress
        }
        {
          name: 'ZCHF_EQUITY_CONTRACT_ADDRESS'
          value: zchfEquityContractAddress
        }
        {
          name: 'ZCHF_STABLECOIN_BRIDGE_CONTRACT_ADDRESS'
          value: zchfStablecoinBridgeContractAddress
        }
        {
          name: 'ZCHF_XCHF_CONTRACT_ADDRESS'
          value: zchfXchfContractAddress
        }
        {
          name: 'DEURO_GRAPH_URL'
          value: deuroGraphUrl
        }
        {
          name: 'DEURO_API_URL'
          value: deuroApiUrl
        }
        {
          name: 'EBEL2X_CONTRACT_ADDRESS'
          value: ebel2XContractAddress
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
          name: 'KRAKEN_WITHDRAW_KEYS'
          value: krakenWithdrawKeys
        }
        {
          name: 'KRAKEN_BTC_DEPOSIT_ADDRESS'
          value: krakenBtcDepositAddress
        }
        {
          name: 'KRAKEN_POLYGON_DEPOSIT_ADDRESS'
          value: krakenPolygonDepositAddress
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
          name: 'BINANCE_WITHDRAW_KEYS'
          value: binanceWithdrawKeys
        }
        {
          name: 'BINANCE_BTC_DEPOSIT_ADDRESS'
          value: binanceBtcDepositAddress
        }
        {
          name: 'BINANCE_EVM_DEPOSIT_ADDRESS'
          value: binanceEvmDepositAddress
        }
        {
          name: 'P2B_KEY'
          value: p2bKey
        }
        {
          name: 'P2B_SECRET'
          value: p2bSecret
        }
        {
          name: 'P2B_WITHDRAW_KEYS'
          value: p2bWithdrawKeys
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
          name: 'REVOLUT_REFRESH_TOKEN'
          value: revolutRefreshToken
        }
        {
          name: 'REVOLUT_CLIENT_ASSERTION'
          value: revolutClientAssertion
        }
        {
          name: 'COIN_GECKO_API_KEY'
          value: coinGeckoApiKey
        }
        {
          name: 'PAYMENT_URL'
          value: paymentUrl
        }
        {
          name: 'SERVICES_URL'
          value: servicesUrl
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
          name: 'LIMIT_REQUEST_SUPPORT_STAFF_MAIL'
          value: limitRequestSupportStaffMail
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
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: azureStorageConnectionString
        }
        {
          name: 'ALBY_CLIENT_ID'
          value: albyClientId
        }
        {
          name: 'ALBY_CLIENT_SECRET'
          value: albyClientSecret
        }
        {
          name: 'REQUEST_KNOWN_IPS'
          value: knownIps
        }
        {
          name: 'REQUEST_LIMIT_CHECK'
          value: limitCheck
        }
        {
          name: 'IKNA_KEY'
          value: iknaKey
        }
        {
          name: 'CKO_PUBLIC_KEY'
          value: ckoPublicKey
        }
        {
          name: 'CKO_SECRET_KEY'
          value: ckoSecretKey
        }
        {
          name: 'CKO_ENTITY_ID'
          value: ckoEntityId
        }
        {
          name: 'SIFT_API_KEY'
          value: siftApiKey
        }
        {
          name: 'SIFT_ACCOUNT_ID'
          value: siftAccountId
        }
        {
          name: 'SIFT_ANALYST'
          value: siftAnalyst
        }
        {
          name: 'WEBSITE_RUN_FROM_PACKAGE'
          value: '1'
        }
        {
          name: 'DILISENSE_JSON_PATH'
          value: delisenseJsonPath
        }
        {
          name: 'DILISENSE_KEY'
          value: delisenseKey
        }
        {
          name: 'ALCHEMY_API_KEY'
          value: alchemyApiKey
        }
        {
          name: 'ALCHEMY_AUTH_TOKEN'
          value: alchemyAuthToken
        }
        {
          name: 'CUSTOM_BALANCE_ASSETS'
          value: customBalanceAssets
        }
        {
          name: 'CUSTOM_BALANCE_ADDRESSES'
          value: customBalanceAddresses
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
module nodes 'defi-node.bicep' = [
  for node in nodeProps: {
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
  }
]

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
      {
        name: 'ThunderHub'
        properties: {
          protocol: 'TCP'
          sourcePortRange: '*'
          destinationPortRange: '4000'
          sourceAddressPrefix: allowedIpRange
          destinationAddressPrefix: '*'
          access: 'Allow'
          priority: 310
          direction: 'Inbound'
        }
      }
      {
        name: 'LNbits'
        properties: {
          protocol: 'TCP'
          sourcePortRange: '*'
          destinationPortRange: lnBitsPort
          sourceAddressPrefix: allowedIpRange
          destinationAddressPrefix: '*'
          access: 'Allow'
          priority: 320
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
    destinationPortRange: btcNodePort
    sourceAddressPrefix: allowedIpRange
    destinationAddressPrefix: '*'
    access: 'Allow'
    priority: 350
    direction: 'Inbound'
  }
}

module btcNodes 'btc-node.bicep' = [
  for node in btcNodeProps: {
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
  }
]
