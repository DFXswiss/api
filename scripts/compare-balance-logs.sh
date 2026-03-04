#!/bin/bash
# Compare two FinancialDataLog entries to find asset changes

set -e

if [ -z "$1" ] || [ -z "$2" ]; then
  echo "Usage: $0 <log_id_1> <log_id_2>"
  exit 1
fi

LOG_ID_1="$1"
LOG_ID_2="$2"

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

# Get both log entries
SQL="SELECT id, created, message FROM log WHERE id IN ($LOG_ID_1, $LOG_ID_2) ORDER BY id"
RESULT=$(curl -s -X POST "$API_URL/gs/debug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"sql\":\"$SQL\"}")

# Parse with jq
echo "$RESULT" | jq -r '
  # Extract both entries
  .[0] as $entry1 |
  .[1] as $entry2 |

  # Parse message JSON
  ($entry1.message | fromjson) as $msg1 |
  ($entry2.message | fromjson) as $msg2 |

  "=== Balance Comparison ===",
  "",
  "Entry 1: ID \($entry1.id) at \($entry1.created)",
  "  plusBalance:  \($msg1.balancesTotal.plusBalanceChf)",
  "  minusBalance: \($msg1.balancesTotal.minusBalanceChf)",
  "  totalBalance: \($msg1.balancesTotal.plusBalanceChf - $msg1.balancesTotal.minusBalanceChf | tostring | .[0:12])",
  "",
  "Entry 2: ID \($entry2.id) at \($entry2.created)",
  "  plusBalance:  \($msg2.balancesTotal.plusBalanceChf)",
  "  minusBalance: \($msg2.balancesTotal.minusBalanceChf)",
  "  totalBalance: \($msg2.balancesTotal.plusBalanceChf - $msg2.balancesTotal.minusBalanceChf | tostring | .[0:12])",
  "",
  "=== Changes ===",
  "  Δ plusBalance:  \($msg2.balancesTotal.plusBalanceChf - $msg1.balancesTotal.plusBalanceChf | tostring | .[0:12])",
  "  Δ minusBalance: \($msg2.balancesTotal.minusBalanceChf - $msg1.balancesTotal.minusBalanceChf | tostring | .[0:12])",
  "  Δ totalBalance: \(($msg2.balancesTotal.plusBalanceChf - $msg2.balancesTotal.minusBalanceChf) - ($msg1.balancesTotal.plusBalanceChf - $msg1.balancesTotal.minusBalanceChf) | tostring | .[0:12])",
  "",
  "=== Top Asset Changes (by CHF impact) ===",
  "",
  # Get all asset IDs from both messages
  ([($msg1.assets | keys[]), ($msg2.assets | keys[])] | unique) as $all_assets |

  # Calculate changes for each asset
  [
    $all_assets[] | . as $asset_id |
    {
      assetId: $asset_id,
      plus1: ($msg1.assets[$asset_id].plusBalance.total // 0),
      plus2: ($msg2.assets[$asset_id].plusBalance.total // 0),
      minus1: ($msg1.assets[$asset_id].minusBalance.total // 0),
      minus2: ($msg2.assets[$asset_id].minusBalance.total // 0),
      price1: ($msg1.assets[$asset_id].priceChf // 0),
      price2: ($msg2.assets[$asset_id].priceChf // 0)
    } |
    . + {
      deltaPlus: (.plus2 - .plus1),
      deltaMinus: (.minus2 - .minus1),
      price: (if .price2 > 0 then .price2 else .price1 end)
    } |
    . + {
      deltaPlusChf: (.deltaPlus * .price),
      deltaMinusChf: (.deltaMinus * .price),
      deltaNetChf: ((.deltaPlus - .deltaMinus) * .price)
    }
  ] |

  # Filter out zero changes
  map(select((.deltaNetChf | if . < 0 then -. else . end) > 10)) |

  # Sort by absolute net CHF change
  sort_by(-.deltaNetChf | if . < 0 then -. else . end) |

  # Take top 20
  .[0:20][] |

  "Asset \(.assetId):  Δnet=\(.deltaNetChf) CHF  (Δplus: \(.deltaPlus) units, Δminus: \(.deltaMinus) units, price: \(.price) CHF)"
'
