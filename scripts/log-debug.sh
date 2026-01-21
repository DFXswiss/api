#!/bin/bash

# DFX API Debug Log Access Script (Azure Application Insights)
#
# Usage:
#   ./scripts/log-debug.sh                                    # Recent exceptions (default)
#   ./scripts/log-debug.sh exceptions                         # Recent exceptions
#   ./scripts/log-debug.sh failures                           # Failed requests
#   ./scripts/log-debug.sh slow [durationMs]                  # Slow dependencies (default: 1000ms)
#   ./scripts/log-debug.sh traces "search term"               # Search in trace messages
#   ./scripts/log-debug.sh operation <guid>                   # Traces by operation ID
#   ./scripts/log-debug.sh events <eventName>                 # Custom events
#
# Options:
#   -h, --hours <n>    Time range in hours (default: 1, max: 168)
#
# Environment:
#   Uses the central .env file. Required variables:
#   - DEBUG_ADDRESS: Wallet address with DEBUG role
#   - DEBUG_SIGNATURE: Signature from signing the DFX login message
#   - DEBUG_API_URL (optional): API URL, defaults to https://api.dfx.swiss/v1

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Load environment variables
if [ -f "$ENV_FILE" ]; then
  source "$ENV_FILE"
else
  echo "Error: Environment file not found: $ENV_FILE"
  echo "Create .env in the api root directory"
  exit 1
fi

# Validate required variables
if [ -z "$DEBUG_ADDRESS" ] || [ -z "$DEBUG_SIGNATURE" ]; then
  echo "Error: DEBUG_ADDRESS and DEBUG_SIGNATURE must be set in .env"
  exit 1
fi

API_URL="${DEBUG_API_URL:-https://api.dfx.swiss/v1}"

# Parse arguments
HOURS=1
COMMAND="${1:-exceptions}"
shift 2>/dev/null || true

# Parse options
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--hours)
      HOURS="$2"
      shift 2
      ;;
    *)
      PARAM="$1"
      shift
      ;;
  esac
done

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

ROLE=$(echo "$TOKEN" | cut -d'.' -f2 | base64 -d 2>/dev/null | jq -r '.role' 2>/dev/null || echo "unknown")
echo "Authenticated with role: $ROLE"
echo ""

# Build request based on command
case $COMMAND in
  exceptions|exc)
    TEMPLATE="exceptions-recent"
    BODY="{\"template\":\"$TEMPLATE\",\"hours\":$HOURS}"
    echo "=== Recent Exceptions (last ${HOURS}h) ==="
    ;;
  failures|fail)
    TEMPLATE="request-failures"
    BODY="{\"template\":\"$TEMPLATE\",\"hours\":$HOURS}"
    echo "=== Failed Requests (last ${HOURS}h) ==="
    ;;
  slow)
    TEMPLATE="dependencies-slow"
    DURATION="${PARAM:-1000}"
    BODY="{\"template\":\"$TEMPLATE\",\"hours\":$HOURS,\"durationMs\":$DURATION}"
    echo "=== Slow Dependencies >${DURATION}ms (last ${HOURS}h) ==="
    ;;
  traces|trace)
    if [ -z "$PARAM" ]; then
      echo "Error: traces requires a search term"
      echo "Usage: ./log-debug.sh traces \"search term\""
      exit 1
    fi
    TEMPLATE="traces-by-message"
    BODY="{\"template\":\"$TEMPLATE\",\"hours\":$HOURS,\"messageFilter\":\"$PARAM\"}"
    echo "=== Traces containing '$PARAM' (last ${HOURS}h) ==="
    ;;
  operation|op)
    if [ -z "$PARAM" ]; then
      echo "Error: operation requires a GUID"
      echo "Usage: ./log-debug.sh operation <guid>"
      exit 1
    fi
    TEMPLATE="traces-by-operation"
    BODY="{\"template\":\"$TEMPLATE\",\"hours\":$HOURS,\"operationId\":\"$PARAM\"}"
    echo "=== Traces for operation $PARAM (last ${HOURS}h) ==="
    ;;
  events|event)
    if [ -z "$PARAM" ]; then
      echo "Error: events requires an event name"
      echo "Usage: ./log-debug.sh events <eventName>"
      exit 1
    fi
    TEMPLATE="custom-events"
    BODY="{\"template\":\"$TEMPLATE\",\"hours\":$HOURS,\"eventName\":\"$PARAM\"}"
    echo "=== Custom Events '$PARAM' (last ${HOURS}h) ==="
    ;;
  *)
    echo "Unknown command: $COMMAND"
    echo ""
    echo "Available commands:"
    echo "  exceptions    Recent exceptions"
    echo "  failures      Failed HTTP requests"
    echo "  slow [ms]     Slow dependencies (default: 1000ms)"
    echo "  traces <msg>  Search trace messages"
    echo "  operation <id> Traces by operation GUID"
    echo "  events <name> Custom events by name"
    exit 1
    ;;
esac

echo ""

# Execute log query
RESULT=$(curl -s -X POST "$API_URL/gs/debug/logs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$BODY")

# Format output
if command -v jq &> /dev/null; then
  # Check if it's an error
  ERROR=$(echo "$RESULT" | jq -r '.message // empty' 2>/dev/null)
  if [ -n "$ERROR" ]; then
    echo "Error: $ERROR"
    exit 1
  fi

  # Get columns and rows
  COLUMNS=$(echo "$RESULT" | jq -r '.columns[].name' 2>/dev/null | tr '\n' '\t')
  ROWS=$(echo "$RESULT" | jq -r '.rows[] | @tsv' 2>/dev/null)

  if [ -z "$ROWS" ]; then
    echo "No results found."
  else
    echo -e "$COLUMNS"
    echo "---"
    echo -e "$ROWS" | head -50

    ROW_COUNT=$(echo "$RESULT" | jq '.rows | length' 2>/dev/null)
    if [ "$ROW_COUNT" -gt 50 ]; then
      echo ""
      echo "... and $((ROW_COUNT - 50)) more rows (showing first 50)"
    fi
  fi
else
  echo "$RESULT"
fi
