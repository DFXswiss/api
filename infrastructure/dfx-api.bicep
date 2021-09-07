// --- PARAMETERS --- //
param location string = 'westeurope'
param environment string = 'dev'

param dbAdminLogin string = 'sql-admin'
@secure()
param dbAdminPassword string
@secure()
param jwtSecret string = newGuid()

@secure()
param mailClientSecret string
@secure()
param mailRefreshToken string


// --- VARIABLES --- //
var systemName = 'dfx-api'

var sqlServerName = 'sql-${systemName}-${environment}'
var sqlDbName = 'sqldb-${systemName}-${environment}'

var appServicePlanName = 'plan-${systemName}-${environment}'
var appServiceName = 'app-${systemName}-${environment}'
var appInsightsName = 'appi-${systemName}-${environment}'


// --- RESOURCES --- //

// SQL Database
resource sqlServer 'Microsoft.Sql/servers@2021-02-01-preview' = {
  name: sqlServerName
  location: location
  properties: {
    administratorLogin: dbAdminLogin
    administratorLoginPassword: dbAdminPassword
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

resource allowAzureIps 'Microsoft.Sql/servers/firewallRules@2021-02-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

// App Service
resource appServicePlan 'Microsoft.Web/serverfarms@2018-02-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  properties: {
      reserved: true
  }
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
}

resource appService 'Microsoft.Web/sites@2018-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      alwaysOn: true
      linuxFxVersion: 'NODE|14-lts'
      appCommandLine: 'npm run start:prod'
      httpLoggingEnabled: true
      logsDirectorySizeLimit: 100
      appSettings: [
        {
          name: 'APPINSIGHTS_INSTRUMENTATIONKEY'
          value: appInsights.properties.InstrumentationKey
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
      ]
    }
    httpsOnly: true
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
