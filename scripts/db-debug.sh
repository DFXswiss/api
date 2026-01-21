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
  echo "  -p, --top-plus [N]            Show top N plus balances from latest entry (default: 15)"
  echo "  -m, --top-minus [N]           Show top N minus balances from latest entry (default: 15)"
  echo ""
  echo "Examples:"
  echo "  ./scripts/db-debug.sh --anomalies 50"
  echo "  ./scripts/db-debug.sh --balance 10"
  echo "  ./scripts/db-debug.sh --top-plus 20"
  echo "  ./scripts/db-debug.sh --top-minus 20"
  echo "  ./scripts/db-debug.sh --asset-history 405 20"
  echo "  ./scripts/db-debug.sh --asset-history Yapeal/EUR 20"
  echo "  ./scripts/db-debug.sh --asset-history MaerkiBaumann/CHF 10"
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
TOP_PLUS_MODE=""
TOP_PLUS_LIMIT="15"
TOP_MINUS_MODE=""
TOP_MINUS_LIMIT="15"

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
  -p|--top-plus)
    TOP_PLUS_MODE="1"
    TOP_PLUS_LIMIT="${2:-15}"
    SQL="SELECT TOP 1 id, message FROM log WHERE subsystem = 'FinancialDataLog' ORDER BY id DESC"
    ;;
  -m|--top-minus)
    TOP_MINUS_MODE="1"
    TOP_MINUS_LIMIT="${2:-15}"
    SQL="SELECT TOP 1 id, message FROM log WHERE subsystem = 'FinancialDataLog' ORDER BY id DESC"
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
elif [ -n "$TOP_PLUS_MODE" ]; then
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required for --top-plus"
    exit 1
  fi

  # Extract top assets by plusBalanceChf
  ASSET_IDS=$(echo "$RESULT" | jq -r --argjson limit "$TOP_PLUS_LIMIT" '
    .[0].message | fromjson | .assets | to_entries |
    map({id: .key, plusBalanceChf: ((.value.plusBalance.total // 0) * (.value.priceChf // 0))}) |
    sort_by(-.plusBalanceChf) | .[0:$limit] | .[].id
  ' | tr '\n' ',' | sed 's/,$//')

  # Fetch asset names
  echo "=== Resolving Asset Names ==="
  ASSET_NAMES_RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sql\":\"SELECT id, name, blockchain FROM asset WHERE id IN ($ASSET_IDS)\"}")

  echo ""
  echo "=== Top $TOP_PLUS_LIMIT Plus Balances ==="
  echo ""
  printf "%-4s  %-25s  %15s  %12s\n" "Rank" "Asset" "Balance" "CHF Value"
  printf "%-4s  %-25s  %15s  %12s\n" "----" "-------------------------" "---------------" "------------"

  # Combine and format output
  echo "$RESULT" | jq -r --argjson limit "$TOP_PLUS_LIMIT" --argjson names "$ASSET_NAMES_RESULT" '
    # Build name lookup
    ($names | map({(.id | tostring): "\(.blockchain)/\(.name)"}) | add) as $lookup |
    .[0].message | fromjson | .assets | to_entries |
    map({
      id: .key,
      plusBalance: (.value.plusBalance.total // 0),
      plusBalanceChf: ((.value.plusBalance.total // 0) * (.value.priceChf // 0))
    }) |
    sort_by(-.plusBalanceChf) | .[0:$limit] | to_entries | .[] |
    "\(.key + 1)|\($lookup[.value.id] // "Unknown")|\(.value.plusBalance)|\(.value.plusBalanceChf | floor)"
  ' | while IFS='|' read -r rank asset balance chf; do
    printf "%-4s  %-25s  %15s  %'12d CHF\n" "$rank" "$asset" "$balance" "$chf"
  done
elif [ -n "$TOP_MINUS_MODE" ]; then
  if ! command -v jq &> /dev/null; then
    echo "Error: jq is required for --top-minus"
    exit 1
  fi

  # Extract top assets by minusBalanceChf
  ASSET_IDS=$(echo "$RESULT" | jq -r --argjson limit "$TOP_MINUS_LIMIT" '
    .[0].message | fromjson | .assets | to_entries |
    map({id: .key, minusBalanceChf: ((.value.minusBalance.total // 0) * (.value.priceChf // 0))}) |
    sort_by(-.minusBalanceChf) | .[0:$limit] | .[].id
  ' | tr '\n' ',' | sed 's/,$//')

  # Fetch asset names
  echo "=== Resolving Asset Names ==="
  ASSET_NAMES_RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"sql\":\"SELECT id, name, blockchain FROM asset WHERE id IN ($ASSET_IDS)\"}")

  echo ""
  echo "=== Top $TOP_MINUS_LIMIT Minus Balances ==="
  echo ""
  printf "%-4s  %-25s  %15s  %12s\n" "Rank" "Asset" "Balance" "CHF Value"
  printf "%-4s  %-25s  %15s  %12s\n" "----" "-------------------------" "---------------" "------------"

  # Combine and format output
  echo "$RESULT" | jq -r --argjson limit "$TOP_MINUS_LIMIT" --argjson names "$ASSET_NAMES_RESULT" '
    # Build name lookup
    ($names | map({(.id | tostring): "\(.blockchain)/\(.name)"}) | add) as $lookup |
    .[0].message | fromjson | .assets | to_entries |
    map({
      id: .key,
      minusBalance: (.value.minusBalance.total // 0),
      minusBalanceChf: ((.value.minusBalance.total // 0) * (.value.priceChf // 0))
    }) |
    sort_by(-.minusBalanceChf) | .[0:$limit] | to_entries | .[] |
    "\(.key + 1)|\($lookup[.value.id] // "Unknown")|\(.value.minusBalance)|\(.value.minusBalanceChf | floor)"
  ' | while IFS='|' read -r rank asset balance chf; do
    printf "%-4s  %-25s  %15s  %'12d CHF\n" "$rank" "$asset" "$balance" "$chf"
  done
else
  if command -v jq &> /dev/null; then
    echo "$RESULT" | jq .
  else
    echo "$RESULT"
  fi
fi
