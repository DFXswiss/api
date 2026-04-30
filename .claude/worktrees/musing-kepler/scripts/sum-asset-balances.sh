#!/bin/bash
# Sum plusBalance.total for assets of a specific financialType

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <log_id> <financial_type>"
  exit 1
fi

LOG_ID="$1"
FINANCIAL_TYPE="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: Environment file not found: $ENV_FILE"
  exit 1
fi

DEBUG_ADDRESS=$(grep -E "^DEBUG_ADDRESS=" "$ENV_FILE" | cut -d'=' -f2-)
DEBUG_SIGNATURE=$(grep -E "^DEBUG_SIGNATURE=" "$ENV_FILE" | cut -d'=' -f2-)
DEBUG_API_URL=$(grep -E "^DEBUG_API_URL=" "$ENV_FILE" | cut -d'=' -f2-)

if [ -z "$DEBUG_ADDRESS" ] || [ -z "$DEBUG_SIGNATURE" ]; then
  echo "Error: DEBUG_ADDRESS and DEBUG_SIGNATURE must be set in .env"
  exit 1
fi

API_URL="${DEBUG_API_URL:-https://api.dfx.swiss/v1}"

# Authenticate
TOKEN_RESPONSE=$(curl -s -X POST "$API_URL/auth" \
  -H "Content-Type: application/json" \
  -d "{\"address\":\"$DEBUG_ADDRESS\",\"signature\":\"$DEBUG_SIGNATURE\"}")

TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.accessToken' 2>/dev/null)

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "Authentication failed"
  exit 1
fi

# Get asset IDs for this financial type
ASSET_IDS=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sql\":\"SELECT id FROM asset WHERE financialType = '$FINANCIAL_TYPE'\"}" | \
  jq -r '.[].id' | tr '\n' ',' | sed 's/,$//')

echo "=== Asset Balance Sum for Financial Type: $FINANCIAL_TYPE ==="
echo "Log ID: $LOG_ID"
echo "Asset IDs: $ASSET_IDS"
echo ""

# Get log entry
SQL="SELECT id, created, message FROM log WHERE id = $LOG_ID"
RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sql\":\"$SQL\"}")

# Parse with jq
echo "$RESULT" | jq -r --arg asset_ids "$ASSET_IDS" '
  .[0] as $entry |
  ($entry.message | fromjson) as $msg |

  # Split asset IDs
  ($asset_ids | split(",") | map(tonumber)) as $ids |

  "Log Entry: \($entry.id) at \($entry.created)",
  "",
  "Individual Asset Balances:",
  "",

  # Process each asset
  [
    $ids[] | . as $id |
    $msg.assets[($id | tostring)] as $asset |
    if $asset then
      {
        id: $id,
        plusTotal: ($asset.plusBalance.total // 0),
        minusTotal: ($asset.minusBalance.total // 0),
        priceChf: ($asset.priceChf // 0),
        plusChf: (($asset.plusBalance.total // 0) * ($asset.priceChf // 0)),
        minusChf: (($asset.minusBalance.total // 0) * ($asset.priceChf // 0)),
        netChf: ((($asset.plusBalance.total // 0) - ($asset.minusBalance.total // 0)) * ($asset.priceChf // 0))
      }
    else
      {
        id: $id,
        plusTotal: 0,
        minusTotal: 0,
        priceChf: 0,
        plusChf: 0,
        minusChf: 0,
        netChf: 0
      }
    end
  ] as $balances |

  # Print details
  ($balances[] | "Asset \(.id):  plus=\(.plusTotal | tostring | .[0:12])  minus=\(.minusTotal | tostring | .[0:12])  price=\(.priceChf | tostring | .[0:10])  →  plusChf=\(.plusChf | tostring | .[0:12])  netChf=\(.netChf | tostring | .[0:12])"),
  "",
  "=== Summary ===",
  "",
  "Total Plus CHF:  \($balances | map(.plusChf) | add)",
  "Total Minus CHF: \($balances | map(.minusChf) | add)",
  "Total Net CHF:   \($balances | map(.netChf) | add)"
'
