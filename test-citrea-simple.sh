#!/bin/bash

echo "CitreaTestnet Integration Test Results"
echo "======================================"

# Check current branch
echo "1. Current Branch: $(git branch --show-current)"

# Count changed files
echo "2. Files changed from develop:"
git diff --name-only develop...citrea_test | wc -l | xargs echo "   Total files changed:"

# Check key files existence
echo "3. Key Files Check:"

files=(
    "src/integration/blockchain/citrea-testnet/citrea-testnet.service.ts"
    "src/integration/goldsky/goldsky.service.ts"
    "src/subdomains/supporting/payin/services/payin-citrea-testnet.service.ts"
    "src/subdomains/supporting/payout/services/payout-citrea-testnet.service.ts"
    "src/subdomains/supporting/payin/strategies/register/impl/citrea-testnet.strategy.ts"
    "migration/1754950663000-citrea-testnet-cbtc-asset.seed.ts"
)

for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✓ $file"
    else
        echo "   ✗ MISSING: $file"
    fi
done

# Check configuration
echo "4. Configuration Check:"
if grep -q "citreaTestnetAddress" src/config/config.ts; then
    echo "   ✓ citreaTestnetAddress in config"
else
    echo "   ✗ Missing citreaTestnetAddress in config"
fi

# Check module registrations
echo "5. Module Registration Check:"
if grep -q "PayInCitreaTestnetService" src/subdomains/supporting/payin/payin.module.ts; then
    echo "   ✓ PayIn module includes CitreaTestnet service"
else
    echo "   ✗ PayIn module missing CitreaTestnet service"
fi

if grep -q "PayoutCitreaTestnetService" src/subdomains/supporting/payout/payout.module.ts; then
    echo "   ✓ PayOut module includes CitreaTestnet service"
else
    echo "   ✗ PayOut module missing CitreaTestnet service"
fi

# Check asset service
echo "6. Asset Service Check:"
if grep -q "getCitreaTestnetCoin" src/shared/models/asset/asset.service.ts; then
    echo "   ✓ getCitreaTestnetCoin method exists"
else
    echo "   ✗ Missing getCitreaTestnetCoin method"
fi

# Check blockchain registry
echo "7. Blockchain Registry Check:"
if grep -q "CitreaTestnetService" src/integration/blockchain/shared/services/blockchain-registry.service.ts; then
    echo "   ✓ CitreaTestnet service in blockchain registry"
else
    echo "   ✗ Missing CitreaTestnet service in blockchain registry"
fi

# TypeScript compilation
echo "8. TypeScript Compilation:"
if npm run build > /dev/null 2>&1; then
    echo "   ✓ TypeScript compilation successful"
else
    echo "   ✗ TypeScript compilation failed"
fi

echo ""
echo "Test completed. Review results above."