#!/bin/sh
set -e

## Global variables
COMP_NAME="dfx"
API_NAME="api"

# --- OPTIONS --- #
environmentOptions=("loc" "dev" "prd")

# "fcp": Frankencoin Ponder
# "dep": dEuro Ponder
# "dea": dEuro API
# "ded": dEuro dApp
# "dem": dEuro Monitoring
# "zanod": Zano Node
# "zanolw": Zano Liquidity Wallet
appNameOptions=("fcp" "dep" "dea" "ded" "dem" "zanod" "zanolw")

# --- FUNCTIONS --- #
selectOption() {
  PS3="${1}: "
  shift
  options=("$@")

  select opt in "${options[@]}" "quit"; do 
      case "$REPLY" in
      *) selection="${opt}"; break ;;
      esac
  done

  if [[ ! $selection || $selection == "quit" ]]; then exit -1; fi
  echo "${selection}"
}

# --- MAIN --- #
ENV=$(selectOption "Select Environment" "${environmentOptions[@]}")
APP=$(selectOption "Select App Name" "${appNameOptions[@]}")

## Resource Group & Deployment
RESOURCE_GROUP_NAME="rg-${COMP_NAME}-${API_NAME}-${ENV}"
DEPLOYMENT_NAME=${COMP_NAME}-${API_NAME}-${ENV}-deployment-$(date +%s)

echo "Resource Group Name: $RESOURCE_GROUP_NAME"
echo "Deployment Name:     $DEPLOYMENT_NAME"
echo "APP Shortname:       $APP"

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
