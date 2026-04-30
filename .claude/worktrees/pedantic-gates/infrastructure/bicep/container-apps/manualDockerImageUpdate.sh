#!/bin/sh
set -e

# Documentation:
# https://learn.microsoft.com/en-us/cli/azure/containerapp?view=azure-cli-latest#az-containerapp-update

# 1. Parameter "fcp": Frankencoin Ponder
# 1. Parameter "dep": Decentralized Euro Ponder
# 1. Parameter "ded": Decentralized Euro DApp
# 1. Parameter "dea": Decentralized Euro API
if [[ ! $1 =~ ^("fcp"|"dep"|"ded"|"dea")$ ]]; then
  echo "Missing 1. parameter: 'fcp' or 'dep' or 'ded' or 'dea' expected ..."
  exit
fi

APP=$1

# 2. Parameter Name of the docker image + revision
if [[ ! $2 ]]; then
  echo "Missing 2. parameter: Name of the docker image expected ..."
  exit
fi

IMAGE_NAME=$2

# 3. Parameter "loc": Local environment
# 3. Parameter "dev": Development environment
# 3. Parameter "prd": Production environment
if [[ ! $3 =~ ^("loc"|"dev"|"prd")$ ]]; then
  echo "Missing 3. parameter: 'loc' or 'dev' or 'prd' expected ..."
  exit
fi

ENV=$3

# Global variables
COMP_NAME="dfx"
API_NAME="api"

RESOURCE_GROUP="rg-${COMP_NAME}-${API_NAME}-${ENV}"
CONTAINERAPP_NAME="ca-${COMP_NAME}-${APP}-${ENV}"
DEPLOY_INFO="manual-`date +%s`"

echo "Resource Group:     ${RESOURCE_GROUP}"
echo "Container App Name: ${CONTAINERAPP_NAME}"
echo "Image Name:         ${IMAGE_NAME}"
echo "Deploy Info:        ${DEPLOY_INFO}"

az containerapp update \
    --resource-group $RESOURCE_GROUP \
    --name $CONTAINERAPP_NAME \
    --image $IMAGE_NAME \
    --set-env-vars DEPLOY_INFO=$DEPLOY_INFO
