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

# 2. Parameter "loc": Local environment
# 2. Parameter "dev": Development environment
# 2. Parameter "prd": Production environment
if [[ ! $2 =~ ^("loc"|"dev"|"prd")$ ]]; then
  echo "Missing 2. parameter: 'loc' or 'dev' or 'prd' expected ..."
  exit
fi

ENV=$2

# Global variables
COMP_NAME="dfx"
API_NAME="api"

RESOURCE_GROUP="rg-${COMP_NAME}-${API_NAME}-${ENV}"
CONTAINERAPP_NAME="ca-${COMP_NAME}-${APP}-${ENV}"
IMAGE_NAME="dfxswiss/deuro-dapp:beta"

echo "Resource Group:     ${RESOURCE_GROUP}"
echo "Container App Name: ${CONTAINERAPP_NAME}"
echo "Image Name:         ${IMAGE_NAME}"

az containerapp update \
    --name $CONTAINERAPP_NAME \
    --resource-group $RESOURCE_GROUP \
    --image $IMAGE_NAME
