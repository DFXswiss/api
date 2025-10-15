// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the application insights')
param applicationInsightsName string

// --- RESOURCES --- //
resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    IngestionMode: 'ApplicationInsights'
    publicNetworkAccessForIngestion: 'Enabled'
    publicNetworkAccessForQuery: 'Enabled'
  }
}
