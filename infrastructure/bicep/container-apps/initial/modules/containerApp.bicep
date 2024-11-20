@description('Basename / Prefix of all resources')
param baseName string

@description('Azure Location/Region')
param location string 

@description('Id of the Container Apps Environment')
param containerAppsEnvironmentId string

@description('Container Image')
param containerImage string

@description('Name of the storage')
param storageName string

@description('Name of the storage share')
param storageShareName string


@description('Tags to be applied to all resources')
param tags object = {}

// Define names
var appName = '${baseName}-aca-hello-app'

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    environmentId: containerAppsEnvironmentId
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
    }
    template: {
      volumes: [
        {
          name: 'app-test-data-volume'
          storageType: 'AzureFile'
          storageName: storageName
        }
      ]
      containers: [
        {
          name: 'app'
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          probes: [
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: 3000
              }
              periodSeconds: 10
              failureThreshold: 3
              initialDelaySeconds: 20
            }
          ]
          env: [
            {
              name: 'ENV_1'
              value: '12345'
            }
            {
              name: 'ENV_2'
              value: 'Hello World'
            }
          ]
          volumeMounts: [
            {
              volumeName: 'app-test-data-volume'
              subPath: storageShareName
              mountPath: '/app/data'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
      }
    }
  }
}

output containerFqdn string = containerApp.properties.configuration.ingress.fqdn
