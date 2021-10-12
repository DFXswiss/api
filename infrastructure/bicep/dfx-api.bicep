// --- PARAMETERS --- //
param location string
param env string

param dbAllowAllIps bool
param dbAdminLogin string
@secure()
param dbAdminPassword string

@secure()
param jwtSecret string = newGuid()

@secure()
param mailClientSecret string
@secure()
param mailRefreshToken string

@secure()
param kycPassword string
param kycPrefix string

@secure()
param githubToken string

@secure()
param nodePassword string
@secure()
param nodeWalletPassword string


// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'
var nodeName = 'node'

var virtualNetName = 'vnet-${compName}-${apiName}-${env}'
var subNetName = 'snet-${compName}-${apiName}-${env}'

var storageAccountName = replace('st-${compName}-${apiName}-${env}', '-', '')
var dbBackupContainerName = 'db-bak'
var nodeFileShareNameA = 'node-data-a'
var nodeFileShareNameB = 'node-data-b'

var sqlServerName = 'sql-${compName}-${apiName}-${env}'
var sqlDbName = 'sqldb-${compName}-${apiName}-${env}'

var apiServicePlanName = 'plan-${compName}-${apiName}-${env}'
var apiAppName = 'app-${compName}-${apiName}-${env}'

var nodeServicePlanName = 'plan-${compName}-${nodeName}-${env}'
var nodeAppName = 'app-${compName}-${nodeName}-${env}'

var appInsightsName = 'appi-${compName}-${apiName}-${env}'


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

resource nodeFileShareA 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeFileShareNameA}'
}

resource nodeFileShareB 'Microsoft.Storage/storageAccounts/fileServices/shares@2021-04-01' = {
  name: '${storageAccount.name}/default/${nodeFileShareNameB}'
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
    name: 'Basic'
    tier: 'Basic'
    capacity: 5
  }
}


// App Service
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
          value: 'dfx'
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
          name: 'NODE_URL_ACTIVE'
          value: node.outputs.url
        }
        {
          name: 'NODE_URL_PASSIVE'
          value: node.outputs.urlStg
        }
        {
          name: 'NODE_WALLET_PASSWORD'
          value: nodeWalletPassword
        }
      ]
    }
  }
}

module node 'defi-node.bicep' = {
  name: '${env}-nodes'
  params: {
    location: location
    servicePlanName: nodeServicePlanName
    appName: nodeAppName
    subnetId: virtualNet.properties.subnets[0].id
    storageAccountName: storageAccountName
    storageAccountId: storageAccount.id
    fileShareNameA: nodeFileShareNameA
    fileShareNameB: nodeFileShareNameB
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
