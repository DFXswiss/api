#!/bin/bash

# DFX API Debug Database Access Script
#
# Usage:
#   ./scripts/db-debug.sh                                    # Default query (assets)
#   ./scripts/db-debug.sh "SELECT TOP 10 id FROM asset"      # Custom SQL query
#   ./scripts/db-debug.sh --anomalies                        # Show invalid FinancialDataLog entries
#   ./scripts/db-debug.sh --balance                          # Show recent balance history
#   ./scripts/db-debug.sh --asset-history Yapeal/EUR 10      # Show asset balance history
#
# Environment:
#   Uses the central .env file. Required variables:
#   - DEBUG_ADDRESS: Wallet address with DEBUG role
#   - DEBUG_SIGNATURE: Signature from signing the DFX login message
#   - DEBUG_API_URL (optional): API URL, defaults to https://api.dfx.swiss/v1
#
# Requirements:
#   - curl
#   - jq (optional, for pretty output)

set -e

# --- Help (before auth) ---
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  echo "DFX API Debug Database Access Script"
  echo ""
  echo "Usage:"
  echo "  ./scripts/db-debug.sh [OPTIONS] [SQL_QUERY]"
  echo ""
  echo "Options:"
  echo "  -h, --help                    Show this help"
  echo "  -a, --anomalies [N]           Show invalid FinancialDataLog entries (default: 20)"
  echo "  -b, --balance [N]             Show recent total balance history (default: 20)"
  echo "  -s, --stats                   Show log statistics by system/subsystem"
  echo "  -A, --asset-history <ID|Blockchain/Name> [N]"
  echo "                                Show balance history for asset (default: 10)"
  echo "  -R, --referral-chain <userDataId>"
  echo "                                Show complete referral chain for user"
  echo ""
  echo "Examples:"
  echo "  ./scripts/db-debug.sh --anomalies 50"
  echo "  ./scripts/db-debug.sh --balance 10"
  echo "  ./scripts/db-debug.sh --asset-history 405 20"
  echo "  ./scripts/db-debug.sh --asset-history Yapeal/EUR 20"
  echo "  ./scripts/db-debug.sh --asset-history MaerkiBaumann/CHF 10"
  echo "  ./scripts/db-debug.sh --referral-chain 370625"
  echo "  ./scripts/db-debug.sh \"SELECT TOP 10 * FROM asset\""
  exit 0
fi

# --- Predefined Queries ---
query_anomalies() {
  local limit="${1:-20}"
  echo "SELECT TOP $limit id, created, JSON_VALUE(message, '\$.balancesTotal.totalBalanceChf') as totalBalanceChf, JSON_VALUE(message, '\$.balancesTotal.plusBalanceChf') as plusBalanceChf, JSON_VALUE(message, '\$.balancesTotal.minusBalanceChf') as minusBalanceChf, valid FROM log WHERE subsystem = 'FinancialDataLog' AND valid = 0 ORDER BY id DESC"
}

query_stats() {
  echo "SELECT system, subsystem, severity, COUNT(*) as count FROM log GROUP BY system, subsystem, severity ORDER BY count DESC"
}

query_balance() {
  local limit="${1:-20}"
  echo "SELECT TOP $limit id, created, JSON_VALUE(message, '\$.balancesTotal.totalBalanceChf') as totalBalanceChf, JSON_VALUE(message, '\$.balancesTotal.plusBalanceChf') as plusBalanceChf, JSON_VALUE(message, '\$.balancesTotal.minusBalanceChf') as minusBalanceChf, valid FROM log WHERE subsystem = 'FinancialDataLog' ORDER BY id DESC"
}

query_asset_raw() {
  local limit="${1:-10}"
  echo "SELECT TOP $limit id, created, message FROM log WHERE subsystem = 'FinancialDataLog' ORDER BY id DESC"
}

# --- Parse arguments FIRST ---
SQL=""
ASSET_HISTORY_MODE=""
ASSET_ID=""
ASSET_INPUT=""
ASSET_LIMIT="10"
REFERRAL_CHAIN_MODE=""
TARGET_USER_ID=""

case "${1:-}" in
  -a|--anomalies)
    SQL=$(query_anomalies "${2:-20}")
    ;;
  -s|--stats)
    SQL=$(query_stats)
    ;;
  -b|--balance)
    SQL=$(query_balance "${2:-20}")
    ;;
  -A|--asset-history)
    if [ -z "${2:-}" ]; then
      echo "Error: --asset-history requires an asset ID or name"
      echo "Usage: ./scripts/db-debug.sh --asset-history <ASSET_ID|Blockchain/Name> [LIMIT]"
      echo ""
      echo "Examples:"
      echo "  ./scripts/db-debug.sh --asset-history 405 20"
      echo "  ./scripts/db-debug.sh --asset-history Yapeal/EUR 20"
      echo "  ./scripts/db-debug.sh --asset-history MaerkiBaumann/CHF 10"
      exit 1
    fi
    ASSET_HISTORY_MODE="1"
    ASSET_INPUT="$2"
    ASSET_LIMIT="${3:-10}"
    ;;
  -R|--referral-chain)
    if [ -z "${2:-}" ]; then
      echo "Error: --referral-chain requires a userDataId"
      echo "Usage: ./scripts/db-debug.sh --referral-chain <userDataId>"
      exit 1
    fi
    REFERRAL_CHAIN_MODE="1"
    TARGET_USER_ID="$2"
    ;;
  *)
    SQL="${1:-SELECT TOP 5 id, name, blockchain FROM asset ORDER BY id DESC}"
    ;;
esac

# --- Load environment ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Environment file not found: $ENV_FILE"
  echo "Create .env in the api root directory"
  exit 1
fi

# Read specific variables (avoid sourcing to prevent bash keyword conflicts)
DEBUG_ADDRESS=$(grep -E "^DEBUG_ADDRESS=" "$ENV_FILE" | cut -d'=' -f2-)
DEBUG_SIGNATURE=$(grep -E "^DEBUG_SIGNATURE=" "$ENV_FILE" | cut -d'=' -f2-)
DEBUG_API_URL=$(grep -E "^DEBUG_API_URL=" "$ENV_FILE" | cut -d'=' -f2-)

if [ -z "$DEBUG_ADDRESS" ] || [ -z "$DEBUG_SIGNATURE" ]; then
  echo "Error: DEBUG_ADDRESS and DEBUG_SIGNATURE must be set in .env"
  exit 1
fi

API_URL="${DEBUG_API_URL:-https://api.dfx.swiss/v1}"

# --- Authenticate ---
echo "=== Authenticating to $API_URL ==="
TOKEN_RESPONSE=$(curl -s -X POST "$API_URL/auth" \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$DEBUG_ADDRESS\",\"signature\":\"$DEBUG_SIGNATURE\"}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.accessToken' 2>/dev/null)

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Authentication failed:"
  echo "$TOKEN_RESPONSE" | jq . 2>/dev/null || echo "$TOKEN_RESPONSE"
  exit 1
fi

ROLE=$(echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq -r '.role' 2>/dev/null || echo "unknown")
echo "Authenticated with role: $ROLE"
echo ""

# --- Referral chain mode ---
if [ -n "$REFERRAL_CHAIN_MODE" ]; then
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required for --referral-chain"
    exit 1
  fi

  echo "=== Referral Chain for UserDataId $TARGET_USER_ID ==="
  echo ""

  # Collect chain by walking up (store as space-separated string for POSIX compatibility)
  CHAIN=""
  METHODS=""
  CURRENT_ID="$TARGET_USER_ID"

  while [ -n "$CURRENT_ID" ]; do
    if [ -z "$CHAIN" ]; then
      CHAIN="$CURRENT_ID"
    else
      CHAIN="$CHAIN $CURRENT_ID"
    fi

    # Query recommendation for current user
    RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"sql\":\"SELECT recommenderId, method, created FROM recommendation WHERE recommendedId = $CURRENT_ID\"}")

    REFERRER_ID=$(echo "$RESULT" | jq -r '.[0].recommenderId // empty')
    METHOD=$(echo "$RESULT" | jq -r '.[0].method // empty')
    CREATED=$(echo "$RESULT" | jq -r '.[0].created // empty' | cut -d'T' -f1)

    if [ -n "$REFERRER_ID" ] && [ "$REFERRER_ID" != "null" ]; then
      # Store method/date for display (format: userId:method:date)
      if [ -z "$METHODS" ]; then
        METHODS="$CURRENT_ID:$METHOD:$CREATED"
      else
        METHODS="$METHODS $CURRENT_ID:$METHOD:$CREATED"
      fi
      CURRENT_ID="$REFERRER_ID"
    else
      CURRENT_ID=""
    fi
  done

  # Convert to array and print chain (reversed, root first)
  CHAIN_ARRAY=($CHAIN)
  CHAIN_LEN=${#CHAIN_ARRAY[@]}

  for ((i=CHAIN_LEN-1; i>=0; i--)); do
    USER_ID="${CHAIN_ARRAY[$i]}"

    if [ $i -eq $((CHAIN_LEN-1)) ]; then
      # Root user (no referrer)
      echo "$USER_ID (Root - no referrer)"
    else
      # Find method for this user
      METHOD_INFO=""
      for entry in $METHODS; do
        entry_id=$(echo "$entry" | cut -d':' -f1)
        if [ "$entry_id" == "$USER_ID" ]; then
          entry_method=$(echo "$entry" | cut -d':' -f2)
          entry_date=$(echo "$entry" | cut -d':' -f3)
          METHOD_INFO="$entry_method ($entry_date)"
          break
        fi
      done

      echo "   ↓ $METHOD_INFO"
      if [ "$USER_ID" == "$TARGET_USER_ID" ]; then
        echo "$USER_ID ← (target)"
      else
        echo "$USER_ID"
      fi
    fi
  done

  exit 0
fi

# --- Resolve asset ID if needed ---
if [ -n "$ASSET_HISTORY_MODE" ]; then
  if [[ "$ASSET_INPUT" =~ ^[0-9]+$ ]]; then
    ASSET_ID="$ASSET_INPUT"
  else
    # Parse Blockchain/Name format
    BLOCKCHAIN=$(echo "$ASSET_INPUT" | cut -d'/' -f1)
    ASSET_NAME=$(echo "$ASSET_INPUT" | cut -d'/' -f2)

    echo "=== Resolving Asset: $BLOCKCHAIN/$ASSET_NAME ==="
    ASSET_QUERY="SELECT id, name, blockchain FROM asset WHERE blockchain = '$BLOCKCHAIN' AND name = '$ASSET_NAME'"
    ASSET_RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"sql\":\"$ASSET_QUERY\"}")

    ASSET_ID=$(echo "$ASSET_RESULT" | jq -r '.[0].id // empty' 2>/dev/null)

    if [ -z "$ASSET_ID" ]; then
      echo "Error: Asset '$ASSET_INPUT' not found"
      echo "$ASSET_RESULT" | jq . 2>/dev/null
      exit 1
    fi
    echo "Found: Asset ID $ASSET_ID"
    echo ""
  fi
  SQL=$(query_asset_raw "$ASSET_LIMIT")
fi

# --- Execute query ---
echo "=== Executing SQL Query ==="
echo "Query: $SQL"
echo ""

RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sql\":\"$SQL\"}")

echo "=== Result ==="

# Special handling for asset history mode (client-side JSON parsing)
if [ -n "$ASSET_HISTORY_MODE" ]; then
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required for --asset-history"
    exit 1
  fi

  echo "Asset ID: $ASSET_ID"
  echo ""
  echo "$RESULT" | jq -r --arg aid "$ASSET_ID" '
    .[] |
    (.message | fromjson) as $msg |
    $msg.assets[$aid] as $asset |
    if $asset then
      "[\(.id)] \(.created | split("T") | .[0]) \(.created | split("T") | .[1] | split(".") | .[0])  plus: \($asset.plusBalance.total // 0 | tostring | .[0:12])  minus: \($asset.minusBalance.total // 0 | tostring | .[0:12])  price: \($asset.priceChf // 0 | tostring | .[0:10])"
    else
      "[\(.id)] Asset \($aid) not found in this log entry"
    end
  ' 2>/dev/null || echo "$RESULT" | jq .
else
  if command -v jq &> /dev/null; then
    echo "$RESULT" | jq .
  else
    echo "$RESULT"
  fi
fi
