#!/bin/bash

# DFX API Debug Database Access Script
#
# Usage:
#   ./scripts/db-debug.sh                                    # Default query (assets)
#   ./scripts/db-debug.sh --anomalies                        # Show invalid FinancialDataLog entries
#   ./scripts/db-debug.sh --balance                          # Show recent balance history
#   ./scripts/db-debug.sh --stats                            # Show log statistics
#   ./scripts/db-debug.sh --asset-history Yapeal/EUR 10      # Show asset balance history
#   ./scripts/db-debug.sh --referral-chain <userDataId>      # Show referral chain
#   ./scripts/db-debug.sh --referral-tree <userDataId>       # Show referral tree
#
# Environment:
#   Uses the central .env file. Required variables:
#   - DEBUG_ADDRESS: Wallet address with DEBUG role
#   - DEBUG_SIGNATURE: Signature from signing the DFX login message
#   - DEBUG_API_URL (optional): API URL, defaults to https://api.dfx.swiss/v1
#
# Requirements:
#   - curl
#   - jq (required: the endpoint now returns structured JSON and we build JSON payloads)
#
# Safety:
#   - DEBUG_API_URL defaults to PRODUCTION. The endpoint is read-only by construction:
#     it accepts a JSON query description and emits parameter-bound SELECT statements
#     through TypeORM. Writes / DDL are not expressible.
#
# Structured /gs/debug endpoint:
#   The endpoint no longer accepts raw SQL. The request body is a JSON description of
#   the query that the service translates into SQL via TypeORM QueryBuilder with bound
#   parameters. Shape:
#
#     {
#       "table": "log",
#       "select": [
#         {"kind": "column", "column": "id"},
#         {"kind": "jsonb", "column": "message", "jsonbPath": "balancesTotal.totalBalanceChf", "as": "totalchf"},
#         {"kind": "aggregate", "aggregate": "count", "column": "id", "as": "n"}
#       ],
#       "where": {
#         "kind": "and",
#         "children": [
#           {"kind": "leaf", "column": "subsystem", "op": "=", "value": "FinancialDataLog"},
#           {"kind": "leaf", "column": "valid", "op": "=", "value": false}
#         ]
#       },
#       "groupBy": ["subsystem"],
#       "orderBy": [{"column": "id", "direction": "DESC"}],
#       "limit": 20
#     }
#
#   Response: {"keys": ["id", "totalchf", "n"], "rows": [[1, "1234.56", 100], ...]}
#
#   Allowed columns are defined per-table in DebugAllowedColumns
#   (src/subdomains/generic/gs/dto/gs.dto.ts). Anything not listed there is unreachable.
#   Column names are camelCase and case-sensitive; table names are snake_case.
#   The `jsonb` select kind is only allowed on columns marked in `jsonbColumns`
#   (currently only `log.message`).
#
#   Updating the allowlist: every migration that adds, renames, or removes a column on a
#   debuggable table must update DebugAllowedColumns to match.
#
# Financial balance semantics (read before interpreting --balance / --anomalies / --stats):
#   These query the FinancialDataLog, which records the whole book valued in CHF. In the
#   balancesTotal object: totalBalanceChf = plusBalanceChf - minusBalanceChf, where plus =
#   assets DFX holds and minus = liabilities owed to customers, each valued at its current
#   priceChf. Customer flow is balance-neutral: a deposit raises plus AND minus equally, and
#   completing the order lowers both again, leaving only the fee. So totalBalanceChf is
#   effectively the operating equity of the flow business and moves ONLY due to:
#     1. operating profit / fees (gradual, positive, realised on order completion)
#     2. FX (plus and minus are different asset baskets, so their CHF marks drift
#        independently while orders are open -- the normal intraday noise)
#     3. an error or a realised loss (a discrete, persisting step)
#   A sudden step (especially negative) is therefore suspicious rather than customer activity.
#   The `valid` column is false when the jump vs. the previous entry exceeds
#   Config.financeLogTotalBalanceChangeLimit and that entry is under 15 minutes old (a larger
#   gap suppresses the flag); --anomalies lists these valid=false rows. Full reference: the
#   BalancesTotal type in src/subdomains/supporting/log/dto/log.dto.ts and LogJobService.

set -e

# --- Help (before auth) ---
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  echo "DFX API Debug Database Access Script"
  echo ""
  echo "Usage:"
  echo "  ./scripts/db-debug.sh [OPTIONS]"
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
  echo "  -T, --referral-tree <userDataId>"
  echo "                                Show complete referral tree (all branches)"
  echo ""
  echo "Examples:"
  echo "  ./scripts/db-debug.sh --anomalies 50"
  echo "  ./scripts/db-debug.sh --balance 10"
  echo "  ./scripts/db-debug.sh --asset-history 405 20"
  echo "  ./scripts/db-debug.sh --asset-history Yapeal/EUR 20"
  echo "  ./scripts/db-debug.sh --asset-history MaerkiBaumann/CHF 10"
  echo "  ./scripts/db-debug.sh --referral-chain 370625"
  echo "  ./scripts/db-debug.sh --referral-tree 370625"
  echo ""
  echo "Direct API example (structured JSON, no raw SQL):"
  echo "  curl -X POST \$API_URL/gs/debug \\"
  echo "    -H 'Authorization: Bearer \$TOKEN' \\"
  echo "    -H 'Content-Type: application/json' \\"
  echo "    -d '{\"table\":\"asset\",\"select\":[{\"kind\":\"column\",\"column\":\"id\"},{\"kind\":\"column\",\"column\":\"name\"}],\"orderBy\":[{\"column\":\"id\",\"direction\":\"DESC\"}],\"limit\":5}'"
  exit 0
fi

# --- jq is required (used both to build payloads and parse responses) ---
if ! command -v jq &> /dev/null; then
  echo "Error: jq is required (used to build JSON payloads and parse responses)"
  exit 1
fi

# --- Payload builders ---
# Each builder emits a JSON object matching DebugQueryDto. We use `jq -n` so values are
# safely quoted even if they contain quotes or backslashes.

payload_default() {
  jq -n '{
    table: "asset",
    select: [
      {kind: "column", column: "id"},
      {kind: "column", column: "name"},
      {kind: "column", column: "blockchain"}
    ],
    orderBy: [{column: "id", direction: "DESC"}],
    limit: 5
  }'
}

payload_anomalies() {
  local limit="${1:-20}"
  jq -n --argjson limit "$limit" '{
    table: "log",
    select: [
      {kind: "column", column: "id"},
      {kind: "column", column: "created"},
      {kind: "jsonb", column: "message", jsonbPath: "balancesTotal.totalBalanceChf", as: "totalchf"},
      {kind: "jsonb", column: "message", jsonbPath: "balancesTotal.plusBalanceChf", as: "pluschf"},
      {kind: "jsonb", column: "message", jsonbPath: "balancesTotal.minusBalanceChf", as: "minuschf"},
      {kind: "column", column: "valid"}
    ],
    where: {
      kind: "and",
      children: [
        {kind: "leaf", column: "subsystem", op: "=", value: "FinancialDataLog"},
        {kind: "leaf", column: "valid", op: "=", value: false}
      ]
    },
    orderBy: [{column: "id", direction: "DESC"}],
    limit: $limit
  }'
}

payload_balance() {
  local limit="${1:-20}"
  jq -n --argjson limit "$limit" '{
    table: "log",
    select: [
      {kind: "column", column: "id"},
      {kind: "column", column: "created"},
      {kind: "jsonb", column: "message", jsonbPath: "balancesTotal.totalBalanceChf", as: "totalchf"},
      {kind: "jsonb", column: "message", jsonbPath: "balancesTotal.plusBalanceChf", as: "pluschf"},
      {kind: "jsonb", column: "message", jsonbPath: "balancesTotal.minusBalanceChf", as: "minuschf"},
      {kind: "column", column: "valid"}
    ],
    where: {
      kind: "leaf", column: "subsystem", op: "=", value: "FinancialDataLog"
    },
    orderBy: [{column: "id", direction: "DESC"}],
    limit: $limit
  }'
}

payload_stats() {
  jq -n '{
    table: "log",
    select: [
      {kind: "column", column: "system"},
      {kind: "column", column: "subsystem"},
      {kind: "column", column: "severity"},
      {kind: "aggregate", aggregate: "count", column: "id", as: "count"}
    ],
    groupBy: ["system", "subsystem", "severity"],
    orderBy: [{column: "count", direction: "DESC"}],
    limit: 1000
  }'
}

payload_asset_raw() {
  local limit="${1:-10}"
  jq -n --argjson limit "$limit" '{
    table: "log",
    select: [
      {kind: "column", column: "id"},
      {kind: "column", column: "created"},
      {kind: "column", column: "message"}
    ],
    where: {
      kind: "leaf", column: "subsystem", op: "=", value: "FinancialDataLog"
    },
    orderBy: [{column: "id", direction: "DESC"}],
    limit: $limit
  }'
}

# --- Parse arguments FIRST ---
PAYLOAD=""
DESCRIPTION=""
ASSET_HISTORY_MODE=""
ASSET_ID=""
ASSET_INPUT=""
ASSET_LIMIT="10"
REFERRAL_CHAIN_MODE=""
REFERRAL_TREE_MODE=""
TARGET_USER_ID=""
OUTPUT_MODE="objects"

case "${1:-}" in
  -a|--anomalies)
    PAYLOAD=$(payload_anomalies "${2:-20}")
    DESCRIPTION="anomalies (invalid FinancialDataLog entries, limit ${2:-20})"
    OUTPUT_MODE="objects"
    ;;
  -s|--stats)
    PAYLOAD=$(payload_stats)
    DESCRIPTION="log statistics by system/subsystem/severity"
    OUTPUT_MODE="objects"
    ;;
  -b|--balance)
    PAYLOAD=$(payload_balance "${2:-20}")
    DESCRIPTION="balance history (FinancialDataLog, limit ${2:-20})"
    OUTPUT_MODE="objects"
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
  -T|--referral-tree)
    if [ -z "${2:-}" ]; then
      echo "Error: --referral-tree requires a userDataId"
      echo "Usage: ./scripts/db-debug.sh --referral-tree <userDataId>"
      exit 1
    fi
    REFERRAL_TREE_MODE="1"
    TARGET_USER_ID="$2"
    ;;
  "")
    PAYLOAD=$(payload_default)
    DESCRIPTION="default query (recent assets)"
    OUTPUT_MODE="objects"
    ;;
  *)
    echo "Error: unknown option '$1'. Raw SQL is no longer supported."
    echo "Run './scripts/db-debug.sh --help' for the list of predefined modes."
    exit 1
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

# --- Helper: convert a {keys, rows} response into an array of objects ---
# Many of the existing jq formatters were written against the pre-migration shape (array
# of objects). This filter rebuilds that shape so we can reuse them.
KEYS_ROWS_TO_OBJECTS='[ .keys as $k | .rows[] | [$k, .] | transpose | map({(.[0]): .[1]}) | add ]'

# --- Helper: build a payload for a single-leaf where query ---
# Used by the referral walkers.
build_leaf_payload() {
  local table="$1"
  local columns_json="$2"   # JSON array of {kind, column, ...}
  local where_column="$3"
  local where_value="$4"    # numeric
  local order_json="$5"     # JSON array of {column, direction} or "null"
  local limit="$6"

  jq -n \
    --arg table "$table" \
    --argjson select "$columns_json" \
    --arg col "$where_column" \
    --argjson val "$where_value" \
    --argjson order "$order_json" \
    --argjson limit "$limit" \
    '{
      table: $table,
      select: $select,
      where: {kind: "leaf", column: $col, op: "=", value: $val},
      orderBy: ($order // []),
      limit: $limit
    } | if (.orderBy | length) == 0 then del(.orderBy) else . end'
}

# --- Referral chain mode ---
if [ -n "$REFERRAL_CHAIN_MODE" ]; then
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
    SELECT_JSON='[{"kind":"column","column":"recommenderId"},{"kind":"column","column":"method"},{"kind":"column","column":"created"}]'
    REQ_PAYLOAD=$(build_leaf_payload "recommendation" "$SELECT_JSON" "recommendedId" "$CURRENT_ID" "null" "1")
    RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$REQ_PAYLOAD")

    ROWS_LEN=$(echo "$RESULT" | jq -r '.rows | length // 0' 2>/dev/null)
    if [ "$ROWS_LEN" = "0" ] || [ -z "$ROWS_LEN" ]; then
      CURRENT_ID=""
      continue
    fi

    REFERRER_ID=$(echo "$RESULT" | jq -r '.rows[0][0] // empty')
    METHOD=$(echo "$RESULT" | jq -r '.rows[0][1] // empty')
    CREATED=$(echo "$RESULT" | jq -r '.rows[0][2] // empty' | cut -d'T' -f1)

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

# --- Referral tree mode ---
if [ -n "$REFERRAL_TREE_MODE" ]; then
  # First, find the root by walking up
  CURRENT_ID="$TARGET_USER_ID"
  ROOT_ID=""

  while [ -n "$CURRENT_ID" ]; do
    ROOT_ID="$CURRENT_ID"
    SELECT_JSON='[{"kind":"column","column":"recommenderId"}]'
    REQ_PAYLOAD=$(build_leaf_payload "recommendation" "$SELECT_JSON" "recommendedId" "$CURRENT_ID" "null" "1")
    RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$REQ_PAYLOAD")
    ROWS_LEN=$(echo "$RESULT" | jq -r '.rows | length // 0' 2>/dev/null)
    if [ "$ROWS_LEN" = "0" ] || [ -z "$ROWS_LEN" ]; then
      CURRENT_ID=""
      continue
    fi
    REFERRER_ID=$(echo "$RESULT" | jq -r '.rows[0][0] // empty')
    if [ -n "$REFERRER_ID" ] && [ "$REFERRER_ID" != "null" ]; then
      CURRENT_ID="$REFERRER_ID"
    else
      CURRENT_ID=""
    fi
  done

  echo "=== Referral Tree for UserDataId $TARGET_USER_ID (Root: $ROOT_ID) ==="
  echo ""

  # Recursive function to print tree
  print_tree() {
    local user_id="$1"
    local prefix="$2"
    local is_last="$3"
    local is_root="$4"

    # Get user status
    local status_select='[{"kind":"column","column":"status"},{"kind":"column","column":"kycStatus"}]'
    local status_payload=$(build_leaf_payload "user_data" "$status_select" "id" "$user_id" "null" "1")
    local status_result=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$status_payload")
    local status=$(echo "$status_result" | jq -r '.rows[0][0] // "?"')
    local kyc_status=$(echo "$status_result" | jq -r '.rows[0][1] // "?"')

    # Build display line
    local marker=""
    if [ "$user_id" == "$TARGET_USER_ID" ]; then
      marker=" ← (target)"
    fi
    local status_info="($status, $kyc_status)"

    if [ "$is_root" == "1" ]; then
      echo "$user_id $status_info$marker"
    else
      if [ "$is_last" == "1" ]; then
        echo "${prefix}└── $user_id $status_info$marker"
      else
        echo "${prefix}├── $user_id $status_info$marker"
      fi
    fi

    # Get children
    local children_select='[{"kind":"column","column":"recommendedId"}]'
    local children_order='[{"column":"created","direction":"ASC"}]'
    local children_payload=$(build_leaf_payload "recommendation" "$children_select" "recommenderId" "$user_id" "$children_order" "1000")
    local children_result=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$children_payload")
    local children=$(echo "$children_result" | jq -r '.rows[]?[0] // empty' 2>/dev/null)

    if [ -n "$children" ]; then
      local children_array=($children)
      local num_children=${#children_array[@]}
      local child_index=0

      for child_id in "${children_array[@]}"; do
        child_index=$((child_index + 1))
        local child_is_last="0"
        if [ $child_index -eq $num_children ]; then
          child_is_last="1"
        fi

        local new_prefix=""
        if [ "$is_root" == "1" ]; then
          new_prefix=""
        elif [ "$is_last" == "1" ]; then
          new_prefix="${prefix}    "
        else
          new_prefix="${prefix}│   "
        fi

        print_tree "$child_id" "$new_prefix" "$child_is_last" "0"
      done
    fi
  }

  # Start printing from root
  print_tree "$ROOT_ID" "" "" "1"

  # Count total users
  echo ""
  KNOWN_IDS="$ROOT_ID"
  TO_CHECK="$ROOT_ID"

  while [ -n "$TO_CHECK" ]; do
    NEW_TO_CHECK=""
    for check_id in $TO_CHECK; do
      count_select='[{"kind":"column","column":"recommendedId"}]'
      count_payload=$(build_leaf_payload "recommendation" "$count_select" "recommenderId" "$check_id" "null" "1000")
      count_children_result=$(curl -s -X POST "$API_URL/gs/debug" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "$count_payload")
      count_children=$(echo "$count_children_result" | jq -r '.rows[]?[0] // empty' 2>/dev/null)
      for child in $count_children; do
        if [[ ! " $KNOWN_IDS " =~ " $child " ]]; then
          KNOWN_IDS="$KNOWN_IDS $child"
          NEW_TO_CHECK="$NEW_TO_CHECK $child"
        fi
      done
    done
    TO_CHECK="$NEW_TO_CHECK"
  done

  TOTAL_COUNT=$(echo $KNOWN_IDS | wc -w | tr -d ' ')
  echo "Total users in tree: $TOTAL_COUNT"

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
    ASSET_PAYLOAD=$(jq -n \
      --arg blockchain "$BLOCKCHAIN" \
      --arg name "$ASSET_NAME" \
      '{
        table: "asset",
        select: [
          {kind: "column", column: "id"},
          {kind: "column", column: "name"},
          {kind: "column", column: "blockchain"}
        ],
        where: {
          kind: "and",
          children: [
            {kind: "leaf", column: "blockchain", op: "=", value: $blockchain},
            {kind: "leaf", column: "name", op: "=", value: $name}
          ]
        },
        limit: 1
      }')
    ASSET_RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "$ASSET_PAYLOAD")

    ASSET_ID=$(echo "$ASSET_RESULT" | jq -r '.rows[0][0] // empty' 2>/dev/null)

    if [ -z "$ASSET_ID" ]; then
      echo "Error: Asset '$ASSET_INPUT' not found"
      echo "$ASSET_RESULT" | jq . 2>/dev/null
      exit 1
    fi
    echo "Found: Asset ID $ASSET_ID"
    echo ""
  fi
  PAYLOAD=$(payload_asset_raw "$ASSET_LIMIT")
  DESCRIPTION="asset history (log.message raw, limit $ASSET_LIMIT)"
  OUTPUT_MODE="asset_history"
fi

# --- Execute query ---
echo "=== Executing Debug Query ==="
echo "Query: $DESCRIPTION"
echo "Payload:"
echo "$PAYLOAD" | jq -c .
echo ""

RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

echo "=== Result ==="

# Detect error responses (no `keys`/`rows` shape) and print verbatim.
HAS_KEYS=$(echo "$RESULT" | jq 'has("keys")' 2>/dev/null || echo "false")
if [ "$HAS_KEYS" != "true" ]; then
  echo "$RESULT" | jq . 2>/dev/null || echo "$RESULT"
  exit 1
fi

case "$OUTPUT_MODE" in
  asset_history)
    # Rebuild rows as objects and pull the message JSON for the requested asset.
    echo "Asset ID: $ASSET_ID"
    echo ""
    echo "$RESULT" | jq -r --arg aid "$ASSET_ID" "
      $KEYS_ROWS_TO_OBJECTS |
      .[] |
      (.message | fromjson) as \$msg |
      \$msg.assets[\$aid] as \$asset |
      if \$asset then
        \"[\(.id)] \(.created | split(\"T\") | .[0]) \(.created | split(\"T\") | .[1] | split(\".\") | .[0])  plus: \(\$asset.plusBalance.total // 0 | tostring | .[0:12])  minus: \(\$asset.minusBalance.total // 0 | tostring | .[0:12])  price: \(\$asset.priceChf // 0 | tostring | .[0:10])\"
      else
        \"[\(.id)] Asset \(\$aid) not found in this log entry\"
      end
    " 2>/dev/null || echo "$RESULT" | jq .
    ;;
  objects)
    # Re-emit as the old array-of-objects shape so output stays consistent with previous runs.
    echo "$RESULT" | jq "$KEYS_ROWS_TO_OBJECTS"
    ;;
  *)
    echo "$RESULT" | jq .
    ;;
esac
