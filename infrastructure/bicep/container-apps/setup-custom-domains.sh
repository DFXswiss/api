#!/bin/sh
set -e

# Documentation:
# Creates custom domains on Azure Front Door and outputs DNS records needed

# --- OPTIONS --- #
environmentOptions=("loc" "dev" "prd")

# --- DOMAINS --- #
# Format: "custom-domain:app-code"
# App codes must match appNameOptions in manualFrontdoorSetup.sh
# Example: "example.com:dea" -> creates custom domain for dEuro API
CUSTOM_DOMAINS=(
  "example.com:dea"
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

# --- MAIN --- #
ENV=$(selectOption "Select Environment" "${environmentOptions[@]}")

# Global variables
COMP_NAME="dfx"
API_NAME="api"

RESOURCE_GROUP="rg-${COMP_NAME}-${API_NAME}-${ENV}"
AFD_PROFILE="afd-${COMP_NAME}-${API_NAME}-${ENV}"

echo "Resource Group:        ${RESOURCE_GROUP}"
echo "Frontdoor Profile:     ${AFD_PROFILE}"

DNS_RECORDS=""

for entry in "${CUSTOM_DOMAINS[@]}"; do
  DOMAIN="${entry%%:*}"
  APP="${entry##*:}"

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

  echo "Endpoint Hostname:"
  echo $ENDPOINT_HOSTNAME

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

  echo "Validation Token:"
  echo $VALIDATION_TOKEN

  # Collect DNS records for summary
  DNS_RECORDS="${DNS_RECORDS}${DOMAIN}|CNAME|${ENDPOINT_HOSTNAME}\n"
  DNS_RECORDS="${DNS_RECORDS}_dnsauth.${DOMAIN}|TXT|${VALIDATION_TOKEN}\n\n"
done

echo ""
echo "--- Associating domains with routes ---"

for entry in "${CUSTOM_DOMAINS[@]}"; do
  DOMAIN="${entry%%:*}"
  APP="${entry##*:}"
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

echo ""
echo "--- DNS Records to Create ---"
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
