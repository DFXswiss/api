#!/bin/sh
set -e

## Global variables
COMP_NAME="dfx"

# --- OPTIONS --- #
environmentOptions=("loc" "dev" "prd")

# "api": DFX API resource group
# "core": DFX core resource group
resourceGroupOptions=("api" "core")

# "node": Node VM
vmNameOptions=("node")

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
VM=$(selectOption "Select VM Name" "${vmNameOptions[@]}")

## Resource Group & Deployment
RESOURCE_GROUP_NAME="rg-${COMP_NAME}-${RG}-${ENV}"
DEPLOYMENT_NAME=${COMP_NAME}-${RG}-${ENV}-deployment-$(date +%s)

echo "Selected ENV:   $ENV"
echo "Selected RG:    $RG"
echo "Selected VM:    $VM"
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
    --parameters vm=$VM \
    --parameters parameters/$ENV-$RG-$VM.json \
    --query properties.outputs.result)

## Output Result
echo "Deployment Result:"
echo $RESULT | jq

echo "...Deployment FINISHED!"
