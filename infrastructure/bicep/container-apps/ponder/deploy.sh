#!/bin/sh
set -e

# 1. Parameter "fcp": Frankencoin Ponder
# 1. Parameter "dep": Decentralized Euro Ponder
if [[ ! $1 =~ ^("fcp"|"dep")$ ]]; then
  echo "Missing 1. parameter: 'fcp' or 'dep' expected ..."
  exit
fi

APP=$1

# 2. Parameter "loc": Local environment
# 2. Parameter "dev": Development environment
# 2. Parameter "prd": Production environment
if [[ ! $2 =~ ^("loc"|"dev"|"prd")$ ]]; then
  echo "Missing 2. parameter: 'loc' or 'dev' or 'prd' expected ..."
  exit
fi

ENV=$2

## Global variables
COMP_NAME="dfx"
API_NAME="api"

## Resource Group & Deployment
RESOURCE_GROUP_NAME="rg-${COMP_NAME}-${API_NAME}-${ENV}"
DEPLOYMENT_NAME=${COMP_NAME}-${API_NAME}-${ENV}-deployment-$(date +%s)

## 
echo "Resource Group Name: $RESOURCE_GROUP_NAME"
echo "Deployment Name:     $DEPLOYMENT_NAME"
echo "APP Shortname:       $APP"

exit

## Deploy Template
RESULT=$(az deployment group create \
    --resource-group $RESOURCE_GROUP_NAME \
    --name $DEPLOYMENT_NAME \
    --template-file main.bicep \
    --parameters env=$ENV \
    --parameters app=$APP \
    --parameters parameters/$ENV-$APP.json \
    --query properties.outputs.result)

## Output Result
echo "Deployment Result:"
echo $RESULT | jq

echo "...Deployment FINISHED!"
