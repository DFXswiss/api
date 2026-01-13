#!/bin/sh
set -e

## Global variables
COMP_NAME="dfx"

# --- OPTIONS --- #
environmentOptions=("loc" "dev" "prd")

# "api": DFX API resource group
resourceGroupOptions=("api" "core")

# "ctn": Citrea Testnet Node
# "sln": Swiss Ledger Node
nodeNameOptions=("ctn" "sln")

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
RG=$(selectOption "Select Resource Group" "${resourceGroupOptions[@]}")
NODE=$(selectOption "Select NODE Name" "${nodeNameOptions[@]}")

## Resource Group & Deployment
RESOURCE_GROUP_NAME="rg-${COMP_NAME}-${RG}-${ENV}"
DEPLOYMENT_NAME=${COMP_NAME}-${RG}-${ENV}-deployment-$(date +%s)

echo "Selected ENV:   $ENV"
echo "Selected RG:    $RG"
echo "Selected NODE:  $NODE"
echo "Resource Group: $RESOURCE_GROUP_NAME"
echo "Deployment:     $DEPLOYMENT_NAME"

## Deploy Template
RESULT=$(az deployment group create \
    --resource-group $RESOURCE_GROUP_NAME \
    --name $DEPLOYMENT_NAME \
    --template-file main.bicep \
    --parameters compName=$COMP_NAME \
    --parameters env=$ENV \
    --parameters rg=$RG \
    --parameters parameters/$ENV-$RG-$NODE.json \
    --query properties.outputs)

## Output Result
echo "Deployment Result:"
echo $RESULT | jq

echo "...Deployment FINISHED!"
