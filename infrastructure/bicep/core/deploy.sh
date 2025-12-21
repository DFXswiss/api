#!/bin/sh
set -e

## Global variables
COMP_NAME="dfx"

# --- OPTIONS --- #
environmentOptions=("dev" "prd")

# "core": DFX core resource group
resourceGroupOptions=("core")

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

## Resource Group & Deployment
RESOURCE_GROUP_NAME="rg-${COMP_NAME}-${RG}-${ENV}"
DEPLOYMENT_NAME=${COMP_NAME}-${RG}-${ENV}-deployment-$(date +%s)

echo "Resource Group Name: $RESOURCE_GROUP_NAME"
echo "Deployment Name:     $DEPLOYMENT_NAME"

## Deploy Template
RESULT=$(az deployment group create \
    --resource-group $RESOURCE_GROUP_NAME \
    --name $DEPLOYMENT_NAME \
    --template-file $RG.bicep \
    --parameters env=$ENV \
    --parameters rg=$RG \
    --parameters parameters/$ENV-$RG.json \
    --query properties.outputs.result)

## Output Result
echo "Deployment Result:"
echo $RESULT | jq

echo "...Deployment FINISHED!"
