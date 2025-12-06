#!/bin/bash
#
# RealUnit API Integration Test Script
# =====================================
# Testet alle RealUnit Brokerbot Endpoints auf Korrektheit
#
# Usage: ./realunit-api.test.sh [dev|prod]
#        Default: dev

# Configuration
ENV="${1:-dev}"

if [ "$ENV" = "prod" ]; then
  API_BASE="https://api.dfx.swiss/v1/realunit"
else
  API_BASE="https://dev.api.dfx.swiss/v1/realunit"
fi

# Test addresses
TEST_WALLET="0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
REALU_TOKEN="0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B"
BROKERBOT="0xcff32c60b87296b8c0c12980de685bed6cb9dd6d"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
PASSED=0
FAILED=0
WARNINGS=0

pass() { echo -e "  ${GREEN}✓ PASS:${NC} $1"; ((PASSED++)); }
fail() { echo -e "  ${RED}✗ FAIL:${NC} $1"; ((FAILED++)); }
warn() { echo -e "  ${YELLOW}⚠ WARN:${NC} $1"; ((WARNINGS++)); }
info() { echo -e "  ${BLUE}ℹ INFO:${NC} $1"; }

echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           RealUnit API Integration Test Suite                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Environment: ${YELLOW}$ENV${NC}"
echo -e "API Base:    ${YELLOW}$API_BASE${NC}"
echo ""

# ============================================================================
# Test 1: GET /brokerbot/price
# ============================================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}▶ TEST: GET /brokerbot/price${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_BASE}/brokerbot/price")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP Status 200"
else
  fail "HTTP Status $HTTP_CODE (expected 200)"
fi

PRICE=$(echo "$BODY" | jq -r '.pricePerShare // "null"')
PRICE_RAW=$(echo "$BODY" | jq -r '.pricePerShareRaw // "null"')

if [ "$PRICE" != "null" ] && [ -n "$PRICE" ]; then
  pass "pricePerShare: $PRICE CHF"
else
  fail "Missing pricePerShare"
fi

if [ "$PRICE_RAW" != "null" ] && [ -n "$PRICE_RAW" ]; then
  pass "pricePerShareRaw: $PRICE_RAW"
else
  fail "Missing pricePerShareRaw"
fi

# ============================================================================
# Test 2: GET /brokerbot/info
# ============================================================================
echo ""
echo -e "${YELLOW}▶ TEST: GET /brokerbot/info${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_BASE}/brokerbot/info")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP Status 200"
else
  fail "HTTP Status $HTTP_CODE (expected 200)"
fi

BROKER_ADDR=$(echo "$BODY" | jq -r '.brokerbotAddress // "null"')
TOKEN_ADDR=$(echo "$BODY" | jq -r '.tokenAddress // "null"')
BASE_CURRENCY=$(echo "$BODY" | jq -r '.baseCurrencyAddress // "null"')
BUYING=$(echo "$BODY" | jq -r '.buyingEnabled // "null"')
SELLING=$(echo "$BODY" | jq -r '.sellingEnabled // "null"')

[ "$BROKER_ADDR" != "null" ] && pass "brokerbotAddress: $BROKER_ADDR" || fail "Missing brokerbotAddress"
[ "$TOKEN_ADDR" != "null" ] && pass "tokenAddress: $TOKEN_ADDR" || fail "Missing tokenAddress"
[ "$BASE_CURRENCY" != "null" ] && pass "baseCurrencyAddress: $BASE_CURRENCY" || fail "Missing baseCurrencyAddress"
[ "$BUYING" != "null" ] && pass "buyingEnabled: $BUYING" || fail "Missing buyingEnabled"
[ "$SELLING" != "null" ] && pass "sellingEnabled: $SELLING" || fail "Missing sellingEnabled"

# Verify addresses
BROKER_LOWER=$(echo "$BROKER_ADDR" | tr '[:upper:]' '[:lower:]')
EXPECTED_LOWER=$(echo "$BROKERBOT" | tr '[:upper:]' '[:lower:]')
[ "$BROKER_LOWER" = "$EXPECTED_LOWER" ] && pass "Brokerbot address matches expected" || fail "Brokerbot address mismatch"

# ============================================================================
# Test 3: GET /brokerbot/buyPrice?shares=10
# ============================================================================
echo ""
echo -e "${YELLOW}▶ TEST: GET /brokerbot/buyPrice?shares=10${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_BASE}/brokerbot/buyPrice?shares=10")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP Status 200"
else
  fail "HTTP Status $HTTP_CODE (expected 200)"
fi

SHARES=$(echo "$BODY" | jq -r '.shares // "null"')
TOTAL=$(echo "$BODY" | jq -r '.totalPrice // "null"')
TOTAL_RAW=$(echo "$BODY" | jq -r '.totalPriceRaw // "null"')
PPS=$(echo "$BODY" | jq -r '.pricePerShare // "null"')

[ "$SHARES" = "10" ] && pass "shares: $SHARES (matches request)" || fail "shares: expected 10, got $SHARES"
[ "$TOTAL" != "null" ] && pass "totalPrice: $TOTAL CHF" || fail "Missing totalPrice"
[ "$TOTAL_RAW" != "null" ] && pass "totalPriceRaw: $TOTAL_RAW" || fail "Missing totalPriceRaw"
[ "$PPS" != "null" ] && pass "pricePerShare: $PPS CHF" || fail "Missing pricePerShare"

# ============================================================================
# Test 4: GET /brokerbot/shares?amount=100
# ============================================================================
echo ""
echo -e "${YELLOW}▶ TEST: GET /brokerbot/shares?amount=100${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_BASE}/brokerbot/shares?amount=100")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP Status 200"
else
  fail "HTTP Status $HTTP_CODE (expected 200)"
fi

AMOUNT=$(echo "$BODY" | jq -r '.amount // "null"')
SHARES=$(echo "$BODY" | jq -r '.shares // "null"')
PPS=$(echo "$BODY" | jq -r '.pricePerShare // "null"')

[ "$AMOUNT" = "100" ] && pass "amount: $AMOUNT CHF (matches request)" || fail "amount: expected 100, got $AMOUNT"
[ "$SHARES" != "null" ] && pass "shares: $SHARES" || fail "Missing shares"
[ "$PPS" != "null" ] && pass "pricePerShare: $PPS CHF" || fail "Missing pricePerShare"

# ============================================================================
# Test 5: GET /allowlist/:address
# ============================================================================
echo ""
echo -e "${YELLOW}▶ TEST: GET /allowlist/:address${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_BASE}/allowlist/${TEST_WALLET}")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP Status 200"
else
  fail "HTTP Status $HTTP_CODE (expected 200)"
fi

ADDR=$(echo "$BODY" | jq -r '.address // empty')
CAN_RECEIVE=$(echo "$BODY" | jq '.canReceive')
IS_FORBIDDEN=$(echo "$BODY" | jq '.isForbidden')
IS_POWER=$(echo "$BODY" | jq '.isPowerlisted')

[ -n "$ADDR" ] && pass "address: $ADDR" || fail "Missing address"
[ "$CAN_RECEIVE" = "true" ] || [ "$CAN_RECEIVE" = "false" ] && pass "canReceive: $CAN_RECEIVE" || fail "Missing canReceive"
[ "$IS_FORBIDDEN" = "true" ] || [ "$IS_FORBIDDEN" = "false" ] && pass "isForbidden: $IS_FORBIDDEN" || fail "Missing isForbidden"
[ "$IS_POWER" = "true" ] || [ "$IS_POWER" = "false" ] && pass "isPowerlisted: $IS_POWER" || fail "Missing isPowerlisted"

if [ "$CAN_RECEIVE" = "true" ]; then
  info "Test wallet CAN receive REALU tokens"
else
  info "Test wallet CANNOT receive REALU (not allowlisted)"
fi

# ============================================================================
# Test 6: GET /bank
# ============================================================================
echo ""
echo -e "${YELLOW}▶ TEST: GET /bank${NC}"

RESPONSE=$(curl -s -w "\n%{http_code}" "${API_BASE}/bank")
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  pass "HTTP Status 200"
else
  fail "HTTP Status $HTTP_CODE (expected 200)"
fi

RECIPIENT=$(echo "$BODY" | jq -r '.recipient // "null"')
ADDRESS=$(echo "$BODY" | jq -r '.address // "null"')
IBAN=$(echo "$BODY" | jq -r '.iban // "null"')
BIC=$(echo "$BODY" | jq -r '.bic // "null"')
BANK_NAME=$(echo "$BODY" | jq -r '.bankName // "null"')
CURRENCY=$(echo "$BODY" | jq -r '.currency // "null"')

if [ "$RECIPIENT" != "null" ] && [ -n "$RECIPIENT" ]; then
  pass "recipient: $RECIPIENT"
else
  fail "Missing recipient (REALUNIT_BANK_RECIPIENT env var not set?)"
fi

if [ "$ADDRESS" != "null" ] && [ -n "$ADDRESS" ]; then
  pass "address: $ADDRESS"
else
  fail "Missing address (REALUNIT_BANK_ADDRESS env var not set?)"
fi

if [ "$IBAN" != "null" ] && [ -n "$IBAN" ]; then
  pass "iban: $IBAN"
  [[ "$IBAN" == CH* ]] && pass "IBAN is Swiss format (CH...)" || warn "IBAN does not start with CH"
else
  fail "Missing iban (REALUNIT_BANK_IBAN env var not set?)"
fi

if [ "$BIC" != "null" ] && [ -n "$BIC" ]; then
  pass "bic: $BIC"
else
  fail "Missing bic (REALUNIT_BANK_BIC env var not set?)"
fi

if [ "$BANK_NAME" != "null" ] && [ -n "$BANK_NAME" ]; then
  pass "bankName: $BANK_NAME"
else
  fail "Missing bankName (REALUNIT_BANK_NAME env var not set?)"
fi

[ "$CURRENCY" = "CHF" ] && pass "currency: CHF" || fail "currency: expected CHF, got $CURRENCY"

# ============================================================================
# Test 7: Existing Endpoints (Smoke Test)
# ============================================================================
echo ""
echo -e "${YELLOW}▶ TEST: Existing Endpoints (Smoke Test)${NC}"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/price")
[ "$HTTP_CODE" = "200" ] && pass "GET /price returns 200" || warn "GET /price returns $HTTP_CODE"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/tokenInfo")
[ "$HTTP_CODE" = "200" ] && pass "GET /tokenInfo returns 200" || warn "GET /tokenInfo returns $HTTP_CODE"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/holders")
[ "$HTTP_CODE" = "200" ] && pass "GET /holders returns 200" || warn "GET /holders returns $HTTP_CODE"

# ============================================================================
# Summary
# ============================================================================
echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Test Summary${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}  SOME TESTS FAILED${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
else
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}  ALL TESTS PASSED${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
fi
