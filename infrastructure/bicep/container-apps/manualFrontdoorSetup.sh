#!/bin/sh
set -e

# Documentation:
# https://learn.microsoft.com/en-gb/azure/container-apps/how-to-integrate-with-azure-front-door

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

# Global variables
COMP_NAME="dfx"
API_NAME="api"

RESOURCE_GROUP="rg-${COMP_NAME}-${API_NAME}-${ENV}"
LOCATION="westeurope"

ENVIRONMENT_NAME="cae-${COMP_NAME}-${API_NAME}-${ENV}"
CONTAINERAPP_NAME="ca-${COMP_NAME}-${APP}-${ENV}"
AFD_PROFILE="afd-${COMP_NAME}-${API_NAME}-${ENV}"
AFD_ENDPOINT="fde-${COMP_NAME}-${APP}-${ENV}"
AFD_ORIGIN_GROUP="fdog-${COMP_NAME}-${APP}-${ENV}"
AFD_ORIGIN="fdon-${COMP_NAME}-${APP}-${ENV}"
AFD_ROUTE="fdor-${COMP_NAME}-${APP}-${ENV}"

echo "Resource Group:        ${RESOURCE_GROUP}"
echo "Location:              ${LOCATION}"
echo "Environment Name:      ${ENVIRONMENT_NAME}"
echo "Container App Name:    ${CONTAINERAPP_NAME}"
echo "Frontdoor Profile:     ${AFD_PROFILE}"
echo "Frontdoor Endpoint:    ${AFD_ENDPOINT}"
echo "Frontdoor Origingroup: ${AFD_ORIGIN_GROUP}"
echo "Frontdoor Origin:      ${AFD_ORIGIN}"
echo "Frontdoor Route:       ${AFD_ROUTE}"

ENVIRONMENT_ID=$(az containerapp env show \
    --resource-group $RESOURCE_GROUP \
    --name $ENVIRONMENT_NAME \
    --query "id" \
    --output tsv)

echo "Environment Id:"
echo $ENVIRONMENT_ID

: '
az containerapp up \
    --name $CONTAINERAPP_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --environment $ENVIRONMENT_NAME \
    --image mcr.microsoft.com/k8se/quickstart:latest \
    --target-port 80 \
    --ingress external \
    --query properties.configuration.ingress.fqdn
'

ACA_ENDPOINT=$(az containerapp show \
    --name $CONTAINERAPP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query properties.configuration.ingress.fqdn \
    --output tsv)

echo "AVA Endpoint:"
echo $ACA_ENDPOINT

az afd endpoint create \
    --resource-group $RESOURCE_GROUP \
    --endpoint-name $AFD_ENDPOINT \
    --profile-name $AFD_PROFILE \
    --enabled-state Enabled

az afd origin-group create \
    --resource-group $RESOURCE_GROUP \
    --origin-group-name $AFD_ORIGIN_GROUP \
    --profile-name $AFD_PROFILE \
    --probe-request-type GET \
    --probe-protocol Http \
    --probe-interval-in-seconds 60 \
    --probe-path / \
    --sample-size 4 \
    --successful-samples-required 3 \
    --additional-latency-in-milliseconds 50

az afd origin create \
    --resource-group $RESOURCE_GROUP \
    --origin-group-name $AFD_ORIGIN_GROUP \
    --origin-name $AFD_ORIGIN \
    --profile-name $AFD_PROFILE \
    --host-name $ACA_ENDPOINT \
    --origin-host-header $ACA_ENDPOINT \
    --priority 1 \
    --weight 500 \
    --enable-private-link true \
    --private-link-location $LOCATION \
    --private-link-request-message "AFD Private Link Request" \
    --private-link-resource $ENVIRONMENT_ID \
    --private-link-sub-resource-type managedEnvironments

az afd route create \
    --resource-group $RESOURCE_GROUP \
    --profile-name $AFD_PROFILE \
    --endpoint-name $AFD_ENDPOINT \
    --forwarding-protocol MatchRequest \
    --route-name $AFD_ROUTE \
    --https-redirect Enabled \
    --origin-group $AFD_ORIGIN_GROUP \
    --supported-protocols Http Https \
    --link-to-default-domain Enabled
