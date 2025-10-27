// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Short name of the Node')
param node string

@description('Short name of the VM')
param vmName string

@description('Port of the Node')
param nodePort int

// --- VARIABLES --- //
var compName = 'dfx'
var apiName = 'api'

var frontDoorName = 'afd-${compName}-${apiName}-${env}'
var publicIpName = 'ip-${compName}-${vmName}-${env}'

var endpointName = 'fde-${compName}-${node}-${env}'
var originGroupName = 'fdog-${compName}-${vmName}-${env}'
var originName = 'fdon-${compName}-${node}-${env}'
var routeName = 'fdor-${compName}-${node}-${env}'

module frontDoor './modules/frontDoor.bicep' = {
  name: 'frontDoor'
  params: {
    frontDoorName: frontDoorName
    publicIpName: publicIpName
    endpointName: endpointName
    originGroupName: originGroupName
    originName: originName
    routeName: routeName
    nodePort: nodePort
  }
}

// Outputs
output vmPublicIp string = frontDoor.outputs.vmPublicIp
output frontDoorEndpoint string = frontDoor.outputs.frontDoorEndpoint
output frontDoorUrl string = frontDoor.outputs.frontDoorUrl
