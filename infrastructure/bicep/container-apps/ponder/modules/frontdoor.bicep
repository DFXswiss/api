// --- PARAMETERS --- //
@description('Azure Location/Region')
param location string = resourceGroup().location

@description('Name of the container app environment')
param environmentName string

@description('Front Door profile name')
param frontDoorProfileName string

@description('Front Door endpoint name')
param frontDoorEndpointName string

@description('Front Door origin group name')
param frontDoorOriginGroupName string

@description('Front Door origin route name')
param frontDoorOriginRouteName string

@description('Front Door origin name')
param frontDoorOriginName string

@description('Hostname of App')
param frontDoorAppHostName string

// --- EXISTING RESOURCES --- //
resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource frontDoorProfile 'Microsoft.Cdn/profiles@2024-09-01' existing = {
  name: frontDoorProfileName
}

// --- RESOURCES --- //
resource frontDoorEndpoint 'Microsoft.Cdn/profiles/afdEndpoints@2024-09-01' = {
  parent: frontDoorProfile
  name: frontDoorEndpointName
  location: 'Global'
  properties: {
    enabledState: 'Enabled'
  }
}

resource frontDoorOriginGroup 'Microsoft.Cdn/profiles/originGroups@2024-09-01' = {
  parent: frontDoorProfile
  name: frontDoorOriginGroupName
  properties: {
    loadBalancingSettings: {
      sampleSize: 4
      successfulSamplesRequired: 3
      additionalLatencyInMilliseconds: 50
    }
    healthProbeSettings: {
      probePath: '/health'
      probeRequestType: 'HEAD'
      probeProtocol: 'Https'
      probeIntervalInSeconds: 100
    }
    sessionAffinityState: 'Disabled'
  }
}

resource frontDoorOrigin 'Microsoft.Cdn/profiles/originGroups/origins@2024-09-01' = {
  parent: frontDoorOriginGroup
  name: frontDoorOriginName
  properties: {
    hostName: frontDoorAppHostName
    httpPort: 80
    httpsPort: 443
    originHostHeader: frontDoorAppHostName
    priority: 1
    weight: 1000
    enabledState: 'Enabled'
    sharedPrivateLinkResource: {
      privateLink: {
        id: environment.id
      }
      privateLinkLocation: location
      requestMessage: 'AFD Private Link Request'
    }
    enforceCertificateNameCheck: true
  }
}

resource frontDoorOriginRoute 'Microsoft.Cdn/profiles/afdEndpoints/routes@2024-09-01' = {
  parent: frontDoorEndpoint
  name: frontDoorOriginRouteName
  properties: {
    originGroup: {
      id: frontDoorOriginGroup.id
    }
    originPath: '/'
    ruleSets: []
    supportedProtocols: [
      'Http'
      'Https'
    ]
    patternsToMatch: [
      '/*'
    ]
    forwardingProtocol: 'HttpsOnly'
    linkToDefaultDomain: 'Enabled'
    httpsRedirect: 'Enabled'
    enabledState: 'Enabled'
  }
  dependsOn: [
    frontDoorOrigin
  ]
}

// --- OUTPUT --- //
output fqdn string = frontDoorEndpoint.properties.hostName
