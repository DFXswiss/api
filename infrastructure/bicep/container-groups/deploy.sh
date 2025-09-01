#!/bin/sh
set -e

## Global variables
COMP_NAME="dfx"
API_NAME="api"

# --- OPTIONS --- #
environmentOptions=("loc" "dev" "prd")

# "hb-deuro-usdt": Hummingbot (dEURO/USDT)
# "hb-deuro-btc":  Hummingbot (dEURO/BTC)
# "hb-deps-usdt":  Hummingbot (dEPS/USDT)
# "hb-deps-btc":   Hummingbot (dEPS/BTC)
instanceNameOptions=("hb-deuro-usdt" "hb-deuro-btc" "hb-deps-usdt" "hb-deps-btc")

# --- ARGUMENTS --- #
DOCKER_USERNAME=
DOCKER_PASSWORD=

while getopts 'u:p:' arg
do
  case $arg in
    u) DOCKER_USERNAME=$OPTARG ;;
    p) DOCKER_PASSWORD=$OPTARG ;;
  esac
done

if [[ -z "$DOCKER_USERNAME" || -z "$DOCKER_PASSWORD" ]]
then
  echo "usage: ${0} -u [docker user] -p [docker password]"
  exit
fi

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
INSTANCE=$(selectOption "Select Instance Name" "${instanceNameOptions[@]}")

## Resource Group & Deployment
RESOURCE_GROUP_NAME="rg-${COMP_NAME}-${API_NAME}-${ENV}"
DEPLOYMENT_NAME=${COMP_NAME}-${API_NAME}-${ENV}-deployment-$(date +%s)

echo "Docker Username:     $DOCKER_USERNAME"
echo "Docker Password:     $DOCKER_PASSWORD"
echo "Resource Group Name: $RESOURCE_GROUP_NAME"
echo "Deployment Name:     $DEPLOYMENT_NAME"
echo "Instance Shortname:  $INSTANCE"

## Deploy Template
RESULT=$(az deployment group create \
    --resource-group $RESOURCE_GROUP_NAME \
    --name $DEPLOYMENT_NAME \
    --template-file main.bicep \
    --parameters env=$ENV \
    --parameters instance=$INSTANCE \
    --parameters parameters/$ENV-$INSTANCE.json \
    --parameters dockerUsername=$DOCKER_USERNAME \
    --parameters dockerPassword=$DOCKER_PASSWORD \
    --query properties.outputs.result)

## Output Result
echo "Deployment Result:"
echo $RESULT | jq

echo "...Deployment FINISHED!"
