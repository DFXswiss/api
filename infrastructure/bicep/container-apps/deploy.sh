#!/bin/sh
set -e

## Global variables
BASE_NAME="app-test"
LOCATION="westeurope"

## Resource Group & Deployment
RESOURCE_GROUP_NAME=rg-$BASE_NAME
DEPLOYMENT_NAME=$BASE_NAME-deployment-$(date +%s)

## 
echo "Resource Group Name: $RESOURCE_GROUP_NAME"
echo "Deployment Name:     $DEPLOYMENT_NAME"

## Deploy Template
RESULT=$(az deployment group create \
    --resource-group $RESOURCE_GROUP_NAME \
    --name $DEPLOYMENT_NAME \
    --template-file main.bicep \
    --parameters baseName=$BASE_NAME \
    --query properties.outputs.result)

## Output Result
echo "Deployment Result:"
echo $RESULT

#PRIVATE_LINK_ENDPOINT_CONNECTION_ID=$(echo $RESULT | jq -r '.value.privateLinkEndpointConnectionId')
FQDN=$(echo $RESULT | jq -r '.value.fqdn')
PRIVATE_LINK_SERVICE_ID=$(echo $RESULT | jq -r '.value.privateLinkServiceId')

## Approve Private Link Service
echo "Private link endpoint connection ID: $PRIVATE_LINK_ENDPOINT_CONNECTION_ID"
az network private-endpoint-connection approve --id $PRIVATE_LINK_ENDPOINT_CONNECTION_ID --description "Frontdoor: Approved by CI/CD"

echo "...Deployment FINISHED!"
echo "Please wait a few minutes until endpoint is established..."
echo "--- FrontDoor FQDN: https://$FQDN ---"
