// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the front door')
param frontDoorName string

@description('Name of the public IP')
param publicIpName string

@description('Name of the endpoint')
param endpointName string

@description('Name of the origin group')
param originGroupName string

@description('Name of the origin')
param originName string

@description('Name of the route')
param routeName string

// --- EXISTING RESOURCES --- //
resource frontDoorProfile 'Microsoft.Cdn/profiles@2025-06-01' existing = {
  name: frontDoorName
}

resource publicIp 'Microsoft.Network/publicIPAddresses@2024-10-01' existing = {
  name: publicIpName
}

resource endpoint 'Microsoft.Cdn/profiles/afdEndpoints@2025-06-01' = {
  parent: frontDoorProfile
  name: endpointName
  location: location
  properties: {
    enabledState: 'Enabled'
  }
}

resource originGroup 'Microsoft.Cdn/profiles/originGroups@2025-06-01' = {
  parent: frontDoorProfile
  name: originGroupName
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/'
      probeRequestType: 'HEAD'
      probeProtocol: 'Http'
      probeIntervalInSeconds: 60
    }
  }
}

resource origin 'Microsoft.Cdn/profiles/originGroups/origins@2025-06-01' = {
  parent: originGroup
  name: originName
  properties: {
    hostName: publicIp.properties.dnsSettings.fqdn
    httpPort: 80
    httpsPort: 443
    originHostHeader: publicIp.properties.dnsSettings.fqdn
    priority: 1
    weight: 500
    enabledState: 'Enabled'
  }
}

resource route 'Microsoft.Cdn/profiles/afdEndpoints/routes@2025-06-01' = {
  parent: endpoint
  name: routeName
  properties: {
    originGroup: {
      id: originGroup.id
    }
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
  }
  dependsOn: [
    origin
  ]
}

// Outputs
output vmPublicIp string = publicIp.properties.ipAddress
output frontDoorEndpoint string = endpoint.properties.hostName
output frontDoorUrl string = 'https://${endpoint.properties.hostName}'
