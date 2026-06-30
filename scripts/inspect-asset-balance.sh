#!/bin/bash
# Inspect detailed balance structure for a specific asset

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <log_id> <asset_id>"
  exit 1
fi

LOG_ID="$1"
ASSET_ID="$2"

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

# Get log entry. The /gs/debug endpoint takes a structured query, not raw SQL — payload
# describes table+select+where+limit and the service emits SQL with parameter binding.
PAYLOAD=$(jq -n --argjson logId "$LOG_ID" '{
  table: "log",
  select: [
    {kind: "column", column: "id"},
    {kind: "column", column: "created"},
    {kind: "column", column: "message"}
  ],
  where: {kind: "leaf", column: "id", op: "=", value: $logId},
  limit: 1
}')
RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

# Response shape: {keys: ["id","created","message"], rows: [[1, "2026-...", "{...}"]]}.
# Reshape back to an array of objects so the existing jq filter is unchanged below.
ROWS=$(echo "$RESULT" | jq '[.keys as $k | .rows[] | [$k, .] | transpose | map({(.[0]): .[1]}) | add]')

# Parse with jq
echo "$ROWS" | jq -r --arg asset_id "$ASSET_ID" '
  .[0] as $entry |
  ($entry.message | fromjson) as $msg |
  $msg.assets[$asset_id] as $asset |

  if $asset then
    "=== Asset \($asset_id) Balance Details ===",
    "",
    "Log Entry: \($entry.id) at \($entry.created)",
    "Price CHF: \($asset.priceChf)",
    "",
    "=== Plus Balance ===",
    "Total: \($asset.plusBalance.total)",
    "",
    if $asset.plusBalance.liquidity then
      "Liquidity: \($asset.plusBalance.liquidity.total)",
      (if $asset.plusBalance.liquidity.liquidityBalance then
        "  - liquidityBalance.total: \($asset.plusBalance.liquidity.liquidityBalance.total)",
        ($asset.plusBalance.liquidity.liquidityBalance | to_entries[] | select(.key != "total") | "    [\(.key)]: \(.value)")
      else empty end),
      (if $asset.plusBalance.liquidity.paymentDepositBalance then
        "  - paymentDepositBalance.total: \($asset.plusBalance.liquidity.paymentDepositBalance.total)"
      else empty end),
      (if $asset.plusBalance.liquidity.manualLiqPosition then
        "  - manualLiqPosition.total: \($asset.plusBalance.liquidity.manualLiqPosition.total)"
      else empty end)
    else
      "Liquidity: N/A"
    end,
    "",
    if $asset.plusBalance.custom then
      "Custom: \($asset.plusBalance.custom.total)",
      ($asset.plusBalance.custom | to_entries[] | select(.key != "total") | "  - \(.key): \(.value)")
    else
      "Custom: N/A"
    end,
    "",
    if $asset.plusBalance.pending then
      "Pending: \($asset.plusBalance.pending.total)",
      (if $asset.plusBalance.pending.cryptoInput then "  - cryptoInput: \($asset.plusBalance.pending.cryptoInput)" else empty end),
      (if $asset.plusBalance.pending.exchangeOrder then "  - exchangeOrder: \($asset.plusBalance.pending.exchangeOrder)" else empty end),
      (if $asset.plusBalance.pending.bridgeOrder then "  - bridgeOrder: \($asset.plusBalance.pending.bridgeOrder)" else empty end),
      (if $asset.plusBalance.pending.fromOlky then "  - fromOlky: \($asset.plusBalance.pending.fromOlky)" else empty end),
      (if $asset.plusBalance.pending.fromKraken then "  - fromKraken: \($asset.plusBalance.pending.fromKraken)" else empty end),
      (if $asset.plusBalance.pending.toKraken then "  - toKraken: \($asset.plusBalance.pending.toKraken)" else empty end),
      (if $asset.plusBalance.pending.fromScrypt then "  - fromScrypt: \($asset.plusBalance.pending.fromScrypt)" else empty end),
      (if $asset.plusBalance.pending.toScrypt then "  - toScrypt: \($asset.plusBalance.pending.toScrypt)" else empty end)
    else
      "Pending: N/A"
    end,
    "",
    "=== Minus Balance ===",
    "Total: \($asset.minusBalance.total)",
    "",
    (if $asset.minusBalance.debt then "Debt: \($asset.minusBalance.debt)" else empty end),
    (if $asset.minusBalance.pending then
      "Pending: \($asset.minusBalance.pending.total)"
    else empty end)
  else
    "Asset \($asset_id) not found in log entry \($entry.id)"
  end
'
