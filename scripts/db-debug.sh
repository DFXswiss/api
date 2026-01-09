#!/bin/bash

# DFX API Debug Database Access Script
#
# Usage:
#   ./scripts/db-debug.sh                                    # Default query (assets)
#   ./scripts/db-debug.sh "SELECT TOP 10 id FROM asset"      # Custom SQL query
#
# Environment:
#   Copy .env.db-debug.sample to .env.db-debug and fill in your credentials
#
# Requirements:
#   - curl
#   - jq (optional, for pretty output)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.db-debug"

# Load environment variables
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
else
  echo "Error: Environment file not found: $ENV_FILE"
  echo "Copy .env.db-debug.sample to .env.db-debug and fill in your credentials"
  exit 1
fi

# Validate required variables
if [ -z "$DEBUG_ADDRESS" ] || [ -z "$DEBUG_SIGNATURE" ]; then
  echo "Error: DEBUG_ADDRESS and DEBUG_SIGNATURE must be set in $ENV_FILE"
  exit 1
fi

API_URL="${DEBUG_API_URL:-https://api.dfx.swiss/v1}"

# Get JWT Token
echo "=== Authenticating to $API_URL ==="
TOKEN_RESPONSE=$(curl -s -X POST "$API_URL/auth/signIn" \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$DEBUG_ADDRESS\",\"signature\":\"$DEBUG_SIGNATURE\"}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.accessToken' 2>/dev/null)

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Authentication failed:"
  echo "$TOKEN_RESPONSE" | jq . 2>/dev/null || echo "$TOKEN_RESPONSE"
  exit 1
fi

# Decode and show role
ROLE=$(echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq -r '.role' 2>/dev/null || echo "unknown")
echo "Authenticated with role: $ROLE"
echo ""

# Default SQL query if none provided
SQL="${1:-SELECT TOP 5 id, name, blockchain FROM asset ORDER BY id DESC}"

echo "=== Executing SQL Query ==="
echo "Query: $SQL"
echo ""

# Execute debug query
RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sql\":\"$SQL\"}")

echo "=== Result ==="
if command -v jq &> /dev/null; then
  echo "$RESULT" | jq .
else
  echo "$RESULT"
fi
