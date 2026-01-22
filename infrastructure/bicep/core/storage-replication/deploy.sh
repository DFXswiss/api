#!/bin/sh
set -e

# --- OPTIONS --- #
environmentOptions=("dev" "prd")

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

ENV=$(selectOption "Select Environment" "${environmentOptions[@]}")

echo "Schritt 1: Subscription-ID holen"
SUB_ID=$(az account show --query id -o tsv)

echo "Sub-ID: $SUB_ID"

echo "Schritt 2: Destination Policy (rg-dfx-core-${ENV})"
az deployment group create \
  --resource-group rg-dfx-core-${ENV} \
  --template-file ./storageObjectReplicationDestination.bicep \
  --parameters \
  destinationStorageAccountName=stdfxcore${ENV} \
  sourceStorageAccountId="/subscriptions/${SUB_ID}/resourceGroups/rg-dfx-api-${ENV}/providers/Microsoft.Storage/storageAccounts/stdfxapi${ENV}"

echo "Schritt 3: Policy-ID und Rules von Azure holen"
POLICY_ID=$(az storage account or-policy list \
  --account-name stdfxcore${ENV} \
  --resource-group rg-dfx-core-${ENV} \
  --query "[0].policyId" -o tsv)

RULES=$(az storage account or-policy list \
  --account-name stdfxcore${ENV} \
  --resource-group rg-dfx-core-${ENV} \
  --query "[0].rules" -o json)

echo "Policy-ID: $POLICY_ID"
echo "Rules: $RULES"

echo "Schritt 4: Source Policy (rg-dfx-api-${ENV})"
az deployment group create \
  --resource-group rg-dfx-api-${ENV} \
  --template-file ./storageObjectReplicationSource.bicep \
  --parameters \
  sourceStorageAccountName=stdfxapi${ENV} \
  destinationStorageAccountId="/subscriptions/${SUB_ID}/resourceGroups/rg-dfx-core-${ENV}/providers/Microsoft.Storage/storageAccounts/stdfxcore${ENV}" \
  replicationPolicyId="${POLICY_ID}" \
  containerRules="${RULES}"
