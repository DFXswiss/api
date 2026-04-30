#!/bin/sh
set -e

# Documentation:
# Creates custom domains on Azure Front Door and optionally creates DNS records in Azure DNS

# --- OPTIONS --- #
environmentOptions=("loc" "dev" "prd")

# --- DOMAINS --- #
# Format: "custom-domain:app-code" (for external DNS)
# Format: "custom-domain:app-code:dns-resource-group:dns-zone" (for Azure DNS)
# App codes must match appNameOptions in manualFrontdoorSetup.sh
# Example: "example.com:dea" -> creates custom domain for dEuro API
# Example: "api.example.com:dea:rg-dns:example.com" -> also creates Azure DNS records
CUSTOM_DOMAINS=(
  # "api.example.com:app" # External DNS (outputs records for manual creation)
  # "api.example.com:app:rg-dns:example.com" # Azure DNS (creates records automatically)
)

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

extractSubdomain() {
  local domain="$1"
  local zone="$2"
  echo "$domain" | sed "s/\.$zone$//"
}

createAzureDnsRecord() {
  local rg="$1"
  local zone="$2"
  local name="$3"
  local type="$4"
  local value="$5"

  echo "Creating DNS record: ${name}.${zone} ${type} ${value}"

  if [ "$type" == "CNAME" ]; then
    # Check if record exists
    EXISTING=$(az network dns record-set cname show \
      --resource-group "$rg" \
      --zone-name "$zone" \
      --name "$name" \
      --query "cnameRecord.cname" \
      --output tsv 2>/dev/null || echo "")

    if [ -n "$EXISTING" ]; then
      echo "  CNAME record already exists, updating..."
      az network dns record-set cname set-record \
        --resource-group "$rg" \
        --zone-name "$zone" \
        --record-set-name "$name" \
        --cname "$value" \
        --output none
    else
      az network dns record-set cname create \
        --resource-group "$rg" \
        --zone-name "$zone" \
        --name "$name" \
        --output none

      az network dns record-set cname set-record \
        --resource-group "$rg" \
        --zone-name "$zone" \
        --record-set-name "$name" \
        --cname "$value" \
        --output none
    fi
  elif [ "$type" == "TXT" ]; then
    # Check if record exists
    EXISTING=$(az network dns record-set txt show \
      --resource-group "$rg" \
      --zone-name "$zone" \
      --name "$name" \
      --query "txtRecords[0].value[0]" \
      --output tsv 2>/dev/null || echo "")

    if [ -n "$EXISTING" ]; then
      echo "  TXT record already exists, updating..."
      # Remove old records and add new one
      az network dns record-set txt remove-record \
        --resource-group "$rg" \
        --zone-name "$zone" \
        --record-set-name "$name" \
        --value "$EXISTING" \
        --output none 2>/dev/null || true
    else
      az network dns record-set txt create \
        --resource-group "$rg" \
        --zone-name "$zone" \
        --name "$name" \
        --output none 2>/dev/null || true
    fi

    az network dns record-set txt add-record \
      --resource-group "$rg" \
      --zone-name "$zone" \
      --record-set-name "$name" \
      --value "$value" \
      --output none
  fi

  echo "  Done."
}

# --- MAIN --- #
ENV=$(selectOption "Select Environment" "${environmentOptions[@]}")

# Global variables
COMP_NAME="dfx"
API_NAME="api"

RESOURCE_GROUP="rg-${COMP_NAME}-${API_NAME}-${ENV}"
AFD_PROFILE="afd-${COMP_NAME}-${API_NAME}-${ENV}"

echo ""
echo "Resource Group:        ${RESOURCE_GROUP}"
echo "Frontdoor Profile:     ${AFD_PROFILE}"

DNS_RECORDS=""

for entry in "${CUSTOM_DOMAINS[@]}"; do
  # Parse entry (domain:app or domain:app:dns-rg:dns-zone)
  IFS=':' read -r DOMAIN APP DNS_RG DNS_ZONE <<< "$entry"

  # Generate resource names
  AFD_ENDPOINT="fde-${COMP_NAME}-${APP}-${ENV}"
  DOMAIN_NAME="${DOMAIN//./-}"

  echo ""
  echo "Custom Domain:         ${DOMAIN}"
  echo "Frontdoor Endpoint:    ${AFD_ENDPOINT}"
  echo "Domain Resource Name:  ${DOMAIN_NAME}"

  # Get endpoint hostname
  ENDPOINT_HOSTNAME=$(az afd endpoint show \
    --resource-group "$RESOURCE_GROUP" \
    --profile-name "$AFD_PROFILE" \
    --endpoint-name "$AFD_ENDPOINT" \
    --query "hostName" \
    --output tsv)

  echo "Endpoint Hostname:     ${ENDPOINT_HOSTNAME}"

  # Check if custom domain already exists
  EXISTING=$(az afd custom-domain show \
    --resource-group "$RESOURCE_GROUP" \
    --profile-name "$AFD_PROFILE" \
    --custom-domain-name "$DOMAIN_NAME" \
    --query "hostName" \
    --output tsv 2>/dev/null || echo "")

  if [ -n "$EXISTING" ]; then
    echo "Custom domain already exists, skipping creation..."
  else
    # Create the custom domain
    az afd custom-domain create \
      --resource-group "$RESOURCE_GROUP" \
      --profile-name "$AFD_PROFILE" \
      --custom-domain-name "$DOMAIN_NAME" \
      --host-name "$DOMAIN" \
      --certificate-type ManagedCertificate \
      --minimum-tls-version TLS12 \
      --output none
  fi

  # Get validation token
  VALIDATION_TOKEN=$(az afd custom-domain show \
    --resource-group "$RESOURCE_GROUP" \
    --profile-name "$AFD_PROFILE" \
    --custom-domain-name "$DOMAIN_NAME" \
    --query "validationProperties.validationToken" \
    --output tsv)

  echo "Validation Token:      ${VALIDATION_TOKEN}"

  # Handle DNS records - Azure DNS if info provided, otherwise collect for manual creation
  if [ -n "$DNS_RG" ] && [ -n "$DNS_ZONE" ]; then
    echo ""
    echo "Creating Azure DNS records in zone ${DNS_ZONE} (${DNS_RG})..."

    # Extract subdomain from full domain
    SUBDOMAIN=$(extractSubdomain "$DOMAIN" "$DNS_ZONE")

    # Create CNAME record
    createAzureDnsRecord "$DNS_RG" "$DNS_ZONE" "$SUBDOMAIN" "CNAME" "$ENDPOINT_HOSTNAME"

    # Create TXT record for validation
    createAzureDnsRecord "$DNS_RG" "$DNS_ZONE" "_dnsauth.${SUBDOMAIN}" "TXT" "$VALIDATION_TOKEN"
  else
    # Collect DNS records for summary (external DNS)
    DNS_RECORDS="${DNS_RECORDS}${DOMAIN}|CNAME|${ENDPOINT_HOSTNAME}\n"
    DNS_RECORDS="${DNS_RECORDS}_dnsauth.${DOMAIN}|TXT|${VALIDATION_TOKEN}\n\n"
  fi
done

echo ""
echo "--- Associating domains with routes ---"

for entry in "${CUSTOM_DOMAINS[@]}"; do
  IFS=':' read -r DOMAIN APP DNS_RG DNS_ZONE <<< "$entry"
  AFD_ENDPOINT="fde-${COMP_NAME}-${APP}-${ENV}"
  AFD_ROUTE="fdor-${COMP_NAME}-${APP}-${ENV}"
  DOMAIN_NAME="${DOMAIN//./-}"

  echo ""
  echo "Associating ${DOMAIN} with route ${AFD_ROUTE}..."

  az afd route update \
    --resource-group $RESOURCE_GROUP \
    --profile-name $AFD_PROFILE \
    --endpoint-name $AFD_ENDPOINT \
    --route-name $AFD_ROUTE \
    --custom-domains $DOMAIN_NAME
done

# Show DNS records summary for external DNS entries
if [ -n "$DNS_RECORDS" ]; then
  echo ""
  echo "--- DNS Records to Create (External DNS) ---"
  echo ""
  printf "%-40s %-8s %s\n" "NAME" "TYPE" "VALUE"
  printf "%-40s %-8s %s\n" "---" "----" "-----"
  printf "%b" "$DNS_RECORDS" | while IFS='|' read -r name type value; do
    if [ -n "$name" ]; then
      # Extract subdomain and root domain (assumes 2-part TLD like .com, .ch)
      root_domain=$(echo "$name" | awk -F. '{print $(NF-1)"."$NF}')
      subdomain=$(echo "$name" | sed "s/\.$root_domain$//")
      printf "%-40s %-8s %s\n" "$subdomain (.$root_domain)" "$type" "$value"
    fi
  done
fi

echo ""
echo "--- Done ---"
