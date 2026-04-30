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

# Account Keys abrufen
SOURCE_KEY=$(az storage account keys list \
  --account-name stdfxapi${ENV} \
  --query "[0].value" -o tsv)

DEST_KEY=$(az storage account keys list \
  --account-name stdfxcore${ENV} \
  --query "[0].value" -o tsv)

# SAS Tokens generieren (gültig für 1 Stunde)
SOURCE_SAS=$(az storage account generate-sas \
  --account-name stdfxapi${ENV} \
  --account-key "${SOURCE_KEY}" \
  --permissions rl \
  --resource-types co \
  --services b \
  --expiry $(date -u -v+1H '+%Y-%m-%dT%H:%MZ') \
  -o tsv)

DEST_SAS=$(az storage account generate-sas \
  --account-name stdfxcore${ENV} \
  --account-key "${DEST_KEY}" \
  --permissions rl \
  --resource-types co \
  --services b \
  --expiry $(date -u -v+1H '+%Y-%m-%dT%H:%MZ') \
  -o tsv)

# Container vergleichen
echo ""
echo "Vergleiche kyc Container:"
azcopy sync \
  "https://stdfxapi${ENV}.blob.core.windows.net/kyc?${SOURCE_SAS}" \
  "https://stdfxcore${ENV}.blob.core.windows.net/kyc?${DEST_SAS}" \
  --dry-run

echo ""
echo "Vergleiche support Container:"
azcopy sync \
  "https://stdfxapi${ENV}.blob.core.windows.net/support?${SOURCE_SAS}" \
  "https://stdfxcore${ENV}.blob.core.windows.net/support?${DEST_SAS}" \
  --dry-run

echo ""
echo "Ende."
