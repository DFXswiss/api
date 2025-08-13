#!/bin/bash

# Comprehensive Test Script for CitreaTestnet Integration Changes
# This script tests all changes between develop and citrea_test branches

set -e  # Exit on any error

echo "=========================================="
echo "CitreaTestnet Integration Test Suite"
echo "=========================================="
echo "Testing all changes between develop and citrea_test branches"
echo "=========================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_TOTAL=0

# Helper functions
print_test_header() {
    echo -e "\n${BLUE}=== TEST: $1 ===${NC}"
    ((TESTS_TOTAL++))
}

print_success() {
    echo -e "${GREEN}✓ PASS:${NC} $1"
    ((TESTS_PASSED++))
}

print_failure() {
    echo -e "${RED}✗ FAIL:${NC} $1"
    ((TESTS_FAILED++))
}

print_warning() {
    echo -e "${YELLOW}⚠ WARNING:${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ INFO:${NC} $1"
}

# Test 1: Verify Git Branch and Changes
print_test_header "Git Branch and Change Detection"

CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" = "citrea_test" ]; then
    print_success "Currently on citrea_test branch"
else
    print_failure "Not on citrea_test branch (currently on: $CURRENT_BRANCH)"
fi

# Get list of changed files between develop and citrea_test
echo -e "\n${BLUE}Files changed between develop and citrea_test:${NC}"
git diff --name-only develop...citrea_test | while read file; do
    echo "  - $file"
done

# Test 2: TypeScript Compilation
print_test_header "TypeScript Compilation"

if npm run build > /dev/null 2>&1; then
    print_success "TypeScript compilation successful"
else
    print_failure "TypeScript compilation failed"
    echo "Running build to show errors:"
    npm run build
fi

# Test 3: Database Migration File
print_test_header "Database Migration for cBTC Asset"

MIGRATION_FILE="migration/1754950663000-citrea-testnet-cbtc-asset.seed.ts"
if [ -f "$MIGRATION_FILE" ]; then
    print_success "Migration file exists: $MIGRATION_FILE"
    
    # Check migration content
    if grep -q "cBTC" "$MIGRATION_FILE"; then
        print_success "Migration contains cBTC asset definition"
    else
        print_failure "Migration file missing cBTC asset definition"
    fi
    
    if grep -q "CitreaTestnet" "$MIGRATION_FILE"; then
        print_success "Migration contains CitreaTestnet blockchain reference"
    else
        print_failure "Migration file missing CitreaTestnet blockchain reference"
    fi
else
    print_failure "Migration file not found: $MIGRATION_FILE"
fi

# Test 4: Configuration Changes
print_test_header "Configuration File Changes"

CONFIG_FILE="src/config/config.ts"
if grep -q "citreaTestnetAddress" "$CONFIG_FILE"; then
    print_success "Config contains citreaTestnetAddress"
else
    print_failure "Config missing citreaTestnetAddress"
fi

if grep -q "PAYMENT_CITREA_TESTNET_ADDRESS" "$CONFIG_FILE"; then
    print_success "Config references environment variable PAYMENT_CITREA_TESTNET_ADDRESS"
else
    print_failure "Config missing environment variable reference"
fi

# Test 5: Blockchain Enum
print_test_header "Blockchain Enum Changes"

BLOCKCHAIN_ENUM="src/integration/blockchain/shared/enums/blockchain.enum.ts"
if [ -f "$BLOCKCHAIN_ENUM" ]; then
    if grep -q "CITREA_TESTNET" "$BLOCKCHAIN_ENUM"; then
        print_success "Blockchain enum contains CITREA_TESTNET"
    else
        print_failure "Blockchain enum missing CITREA_TESTNET"
    fi
else
    print_failure "Blockchain enum file not found"
fi

# Test 6: CitreaTestnet Service Implementation
print_test_header "CitreaTestnet Service Implementation"

CITREA_SERVICE="src/integration/blockchain/citrea-testnet/citrea-testnet.service.ts"
if [ -f "$CITREA_SERVICE" ]; then
    print_success "CitreaTestnet service file exists"
    
    # Check service extends EvmService
    if grep -q "extends EvmService" "$CITREA_SERVICE"; then
        print_success "CitreaTestnet service extends EvmService"
    else
        print_failure "CitreaTestnet service does not extend EvmService"
    fi
    
    # Check Goldsky integration
    if grep -q "goldsky" "$CITREA_SERVICE" || grep -q "Goldsky" "$CITREA_SERVICE"; then
        print_success "CitreaTestnet service includes Goldsky integration"
    else
        print_warning "CitreaTestnet service may be missing Goldsky integration"
    fi
else
    print_failure "CitreaTestnet service file not found"
fi

# Test 7: Goldsky Service
print_test_header "Goldsky Service Implementation"

GOLDSKY_SERVICE="src/integration/goldsky/services/goldsky.service.ts"
if [ -f "$GOLDSKY_SERVICE" ]; then
    print_success "Goldsky service file exists"
    
    # Check for HTTP client
    if grep -q "HttpService\|axios\|fetch" "$GOLDSKY_SERVICE"; then
        print_success "Goldsky service includes HTTP client"
    else
        print_failure "Goldsky service missing HTTP client"
    fi
    
    # Check for GraphQL query methods
    if grep -q "query\|graphql\|gql" "$GOLDSKY_SERVICE"; then
        print_success "Goldsky service includes GraphQL functionality"
    else
        print_failure "Goldsky service missing GraphQL functionality"
    fi
else
    print_failure "Goldsky service file not found"
fi

# Test 8: PayIn Service for CitreaTestnet
print_test_header "PayIn Service for CitreaTestnet"

PAYIN_SERVICE="src/subdomains/supporting/payin/services/payin-citrea-testnet.service.ts"
if [ -f "$PAYIN_SERVICE" ]; then
    print_success "PayIn CitreaTestnet service exists"
    
    # Check it extends PayInEvmService
    if grep -q "extends PayInEvmService" "$PAYIN_SERVICE"; then
        print_success "PayIn service extends PayInEvmService"
    else
        print_failure "PayIn service does not extend PayInEvmService"
    fi
else
    print_failure "PayIn CitreaTestnet service not found"
fi

# Test 9: PayOut Service for CitreaTestnet
print_test_header "PayOut Service for CitreaTestnet"

PAYOUT_SERVICE="src/subdomains/supporting/payout/services/payout-citrea-testnet.service.ts"
if [ -f "$PAYOUT_SERVICE" ]; then
    print_success "PayOut CitreaTestnet service exists"
    
    # Check it extends PayOutEvmService
    if grep -q "extends PayOutEvmService" "$PAYOUT_SERVICE"; then
        print_success "PayOut service extends PayOutEvmService"
    else
        print_failure "PayOut service does not extend PayOutEvmService"
    fi
else
    print_failure "PayOut CitreaTestnet service not found"
fi

# Test 10: Transaction Monitoring Strategy
print_test_header "Transaction Monitoring Strategy"

REGISTER_STRATEGY="src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts"
if [ -f "$REGISTER_STRATEGY" ]; then
    print_success "CitreaTestnet register strategy exists"
    
    # Check for cron job implementation
    if grep -q "@DfxCron\|CronExpression" "$REGISTER_STRATEGY"; then
        print_success "Strategy includes cron job for transaction monitoring"
    else
        print_failure "Strategy missing cron job implementation"
    fi
    
    # Check for Goldsky integration
    if grep -q "goldsky\|Goldsky" "$REGISTER_STRATEGY"; then
        print_success "Strategy includes Goldsky integration"
    else
        print_failure "Strategy missing Goldsky integration"
    fi
    
    # Check for state persistence
    if grep -q "SettingService\|lastProcessedBlock" "$REGISTER_STRATEGY"; then
        print_success "Strategy includes state persistence"
    else
        print_failure "Strategy missing state persistence"
    fi
    
    # Check for deduplication logic
    if grep -q "processedTransactions\|Set<string>" "$REGISTER_STRATEGY"; then
        print_success "Strategy includes deduplication logic"
    else
        print_failure "Strategy missing deduplication logic"
    fi
    
    # Check for race condition protection
    if grep -q "isProcessing\|mutex\|lock" "$REGISTER_STRATEGY"; then
        print_success "Strategy includes race condition protection"
    else
        print_failure "Strategy missing race condition protection"
    fi
else
    print_failure "CitreaTestnet register strategy not found"
fi

# Test 11: Asset Service Changes
print_test_header "Asset Service getCitreaTestnetCoin Method"

ASSET_SERVICE="src/shared/models/asset/asset.service.ts"
if [ -f "$ASSET_SERVICE" ]; then
    if grep -q "getCitreaTestnetCoin" "$ASSET_SERVICE"; then
        print_success "Asset service includes getCitreaTestnetCoin method"
        
        # Check method implementation
        if grep -A 6 "getCitreaTestnetCoin" "$ASSET_SERVICE" | grep -q "cBTC"; then
            print_success "getCitreaTestnetCoin method returns cBTC asset"
        else
            print_failure "getCitreaTestnetCoin method implementation incorrect"
        fi
        
        if grep -A 6 "getCitreaTestnetCoin" "$ASSET_SERVICE" | grep -q "CITREA_TESTNET"; then
            print_success "getCitreaTestnetCoin method uses CITREA_TESTNET blockchain"
        else
            print_failure "getCitreaTestnetCoin method missing blockchain reference"
        fi
    else
        print_failure "Asset service missing getCitreaTestnetCoin method"
    fi
else
    print_failure "Asset service file not found"
fi

# Test 12: Module Registration
print_test_header "Module Registration and Dependencies"

# Test PayIn Module
PAYIN_MODULE="src/subdomains/supporting/payin/payin.module.ts"
if [ -f "$PAYIN_MODULE" ]; then
    if grep -q "PayInCitreaTestnetService" "$PAYIN_MODULE"; then
        print_success "PayIn module includes CitreaTestnet service"
    else
        print_failure "PayIn module missing CitreaTestnet service"
    fi
    
    if grep -q "CitreaTestnetStrategy.*R\|CitreaTestnetStrategyR" "$PAYIN_MODULE"; then
        print_success "PayIn module includes CitreaTestnet register strategy"
    else
        print_failure "PayIn module missing CitreaTestnet register strategy"
    fi
    
    if grep -q "CitreaTestnetStrategy.*S\|CitreaTestnetStrategyS\|CitreaTestnetCoinStrategy.*S\|CitreaTestnetTokenStrategy.*S" "$PAYIN_MODULE"; then
        print_success "PayIn module includes CitreaTestnet send strategies"
    else
        print_failure "PayIn module missing CitreaTestnet send strategies"
    fi
else
    print_failure "PayIn module file not found"
fi

# Test PayOut Module
PAYOUT_MODULE="src/subdomains/supporting/payout/payout.module.ts"
if [ -f "$PAYOUT_MODULE" ]; then
    if grep -q "PayOutCitreaTestnetService" "$PAYOUT_MODULE"; then
        print_success "PayOut module includes CitreaTestnet service"
    else
        print_failure "PayOut module missing CitreaTestnet service"
    fi
    
    if grep -q "CitreaTestnetStrategy.*PR\|CitreaTestnetStrategyPR" "$PAYOUT_MODULE"; then
        print_success "PayOut module includes CitreaTestnet prepare strategy"
    else
        print_failure "PayOut module missing CitreaTestnet prepare strategy"
    fi
    
    if grep -q "CitreaTestnetStrategy.*PO\|CitreaTestnetStrategyPO\|CitreaTestnetCoinStrategy.*PO\|CitreaTestnetTokenStrategy.*PO" "$PAYOUT_MODULE"; then
        print_success "PayOut module includes CitreaTestnet payout strategies"
    else
        print_failure "PayOut module missing CitreaTestnet payout strategies"
    fi
else
    print_failure "PayOut module file not found"
fi

# Test 13: Blockchain Registry Service
print_test_header "Blockchain Registry Service Integration"

REGISTRY_SERVICE="src/integration/blockchain/shared/services/blockchain-registry.service.ts"
if [ -f "$REGISTRY_SERVICE" ]; then
    if grep -q "CitreaTestnetService" "$REGISTRY_SERVICE"; then
        print_success "Blockchain registry includes CitreaTestnet service import"
    else
        print_failure "Blockchain registry missing CitreaTestnet service import"
    fi
    
    if grep -q "citreaTestnetService.*CitreaTestnetService" "$REGISTRY_SERVICE"; then
        print_success "Blockchain registry includes CitreaTestnet service injection"
    else
        print_failure "Blockchain registry missing CitreaTestnet service injection"
    fi
    
    if grep -A 10 -B 5 "case Blockchain.CITREA_TESTNET" "$REGISTRY_SERVICE" | grep -q "citreaTestnetService"; then
        print_success "Blockchain registry includes CitreaTestnet case in getService method"
    else
        print_failure "Blockchain registry missing CitreaTestnet case in getService method"
    fi
else
    print_failure "Blockchain registry service file not found"
fi

# Test 14: Strategy Files Existence
print_test_header "Strategy Files Existence"

# PayIn strategies
strategies=(
    "src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts"
    "src/subdomains/supporting/payin/strategies/send/impl/citrea-testnet-coin.strategy.ts"
    "src/subdomains/supporting/payin/strategies/send/impl/citrea-testnet-token.strategy.ts"
    "src/subdomains/supporting/payout/strategies/prepare/impl/citrea-testnet.strategy.ts"
    "src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-coin.strategy.ts"
    "src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-token.strategy.ts"
)

for strategy in "${strategies[@]}"; do
    if [ -f "$strategy" ]; then
        print_success "Strategy file exists: $(basename "$strategy")"
    else
        print_failure "Strategy file missing: $strategy"
    fi
done

# Test 15: Environment Variable Documentation
print_test_header "Environment Variable Requirements"

print_info "Required environment variables for CitreaTestnet:"
echo "  - PAYMENT_CITREA_TESTNET_ADDRESS: Address for payment deposits"
echo "  - GOLDSKY_API_URL: Goldsky GraphQL endpoint URL" 
echo "  - GOLDSKY_API_KEY: Goldsky API authentication key"
echo "  - Additional blockchain RPC URLs may be required"

# Test 16: Code Quality Checks
print_test_header "Code Quality and Best Practices"

# Check for TODO comments that should be resolved
if grep -r "TODO.*CitreaTestnet\|TODO.*citrea" src/ --include="*.ts" 2>/dev/null; then
    print_warning "Found TODO comments related to CitreaTestnet - review if these should be completed"
else
    print_success "No pending TODO comments found for CitreaTestnet"
fi

# Check for console.log statements (should use logger instead)
if grep -r "console\.log" src/ --include="*.ts" | grep -i citrea 2>/dev/null; then
    print_failure "Found console.log statements - should use DfxLogger instead"
else
    print_success "No console.log statements found in CitreaTestnet code"
fi

# Check for proper error handling
CITREA_FILES=$(find src/ -name "*citrea*" -type f -name "*.ts")
for file in $CITREA_FILES; do
    if [ -f "$file" ]; then
        if grep -q "try.*catch\|\.catch(" "$file"; then
            print_success "$(basename "$file") includes error handling"
        else
            print_warning "$(basename "$file") may be missing error handling"
        fi
    fi
done

# Test 17: Integration Tests
print_test_header "Integration Test Recommendations"

print_info "Recommended integration tests to perform:"
echo "  1. Database Migration Test:"
echo "     - Run migration to create cBTC asset"
echo "     - Verify asset exists with correct properties"
echo "  2. Service Instantiation Test:"
echo "     - Start application and verify all CitreaTestnet services load"
echo "     - Check no dependency injection errors"
echo "  3. Goldsky Connection Test:"
echo "     - Test GraphQL connection to Goldsky API"
echo "     - Verify API key authentication works"
echo "  4. Transaction Monitor Test:"
echo "     - Verify cron job starts correctly"
echo "     - Test block range processing logic"
echo "     - Verify state persistence works"
echo "  5. Asset Queries Test:"
echo "     - Test getCitreaTestnetCoin() method"
echo "     - Verify blockchain registry returns correct service"
echo "  6. PayIn/PayOut Flow Test:"
echo "     - Test address generation"
echo "     - Test transaction detection and processing"
echo "     - Verify proper asset handling"

# Test 18: Security Considerations
print_test_header "Security Considerations"

print_info "Security aspects to verify:"
echo "  - API keys should be in environment variables, not hardcoded"
echo "  - Transaction amounts should be validated and sanitized"
echo "  - Address validation should be implemented"
echo "  - Rate limiting should be considered for external API calls"
echo "  - Error messages should not leak sensitive information"

# Check for hardcoded secrets
if grep -r -i "api.*key.*=.*['\"][^'\"]*['\"]" src/ --include="*.ts" | grep -v "process.env" 2>/dev/null; then
    print_failure "Found potentially hardcoded API keys"
else
    print_success "No hardcoded API keys found"
fi

# Test Summary
echo -e "\n${BLUE}=========================================="
echo "TEST SUMMARY"
echo "==========================================${NC}"
echo "Total Tests: $TESTS_TOTAL"
echo -e "Passed: ${GREEN}$TESTS_PASSED${NC}"
echo -e "Failed: ${RED}$TESTS_FAILED${NC}"
echo "Success Rate: $(( TESTS_PASSED * 100 / TESTS_TOTAL ))%"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "\n${GREEN}🎉 ALL TESTS PASSED! CitreaTestnet integration appears to be complete.${NC}"
    exit 0
else
    echo -e "\n${RED}❌ Some tests failed. Please review the failures above.${NC}"
    exit 1
fi