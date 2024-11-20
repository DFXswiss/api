#!/bin/sh
set -e

## Global variables
BASE_NAME="app-test"

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

FQDN=$(echo $RESULT | jq -r '.value.fqdn')

echo "...Deployment FINISHED!"
echo "Please wait a few minutes until endpoint is established..."
echo "--- FrontDoor FQDN: https://$FQDN ---"
