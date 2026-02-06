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

# SAS Tokens generieren (gültig für 1 Stunde)
SOURCE_SAS=$(az storage account generate-sas \
  --account-name stdfxapi${ENV} \
  --permissions rl \
  --resource-types co \
  --services b \
  --expiry $(date -u -v+1H '+%Y-%m-%dT%H:%MZ') \
  -o tsv)

DEST_SAS=$(az storage account generate-sas \
  --account-name stdfxcore${ENV} \
  --permissions rwdlac \
  --resource-types co \
  --services b \
  --expiry $(date -u -v+1H '+%Y-%m-%dT%H:%MZ') \
  -o tsv)

# Kopieren
azcopy copy \
  "https://stdfxapi${ENV}.blob.core.windows.net/kyc/*?${SOURCE_SAS}" \
  "https://stdfxcore${ENV}.blob.core.windows.net/kyc/?${DEST_SAS}" \
  --recursive

azcopy copy \
  "https://stdfxapi${ENV}.blob.core.windows.net/support/*?${SOURCE_SAS}" \
  "https://stdfxcore${ENV}.blob.core.windows.net/support/?${DEST_SAS}" \
  --recursive
