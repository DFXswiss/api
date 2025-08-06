# CitreaTestnet BTC Integration Setup

## Overview
This guide explains how to set up BTC on CitreaTestnet with the same pricing as native Bitcoin.

## Key Concept: Shared Price Rule
**CitreaTestnet BTC uses the EXACT SAME PriceRule as Bitcoin**, ensuring:
- Identical pricing across both chains
- No price discrepancies
- Single source of truth for BTC value
- Simplified price management

## Setup Steps

### 1. Environment Variables
Add to your `.env` file:
```bash
# CitreaTestnet Configuration
CITREA_TESTNET_WALLET_ADDRESS=0x...  # Your CitreaTestnet wallet
CITREA_TESTNET_WALLET_PRIVATE_KEY=... # Private key for transactions
CITREA_TESTNET_GATEWAY_URL=https://rpc.testnet.citrea.xyz
CITREA_TESTNET_API_KEY=               # Optional, if using custom RPC
CITREA_TESTNET_CHAIN_ID=5115          # CitreaTestnet chain ID
```

### 2. Database Setup

#### Option A: SQL Script
Run the SQL script to add CitreaTestnet BTC:
```sql
-- Find Bitcoin's price rule
DECLARE @BitcoinPriceRuleId INT;
SELECT @BitcoinPriceRuleId = priceRuleId 
FROM asset 
WHERE blockchain = 'Bitcoin' AND name = 'Bitcoin';

-- Add CitreaTestnet BTC with SAME price rule
INSERT INTO asset (
    blockchain, type, name, symbol, uniqueName,
    chainId, decimals, buyable, sellable, priceRuleId
) VALUES (
    'CitreaTestnet', 'TOKEN', 'Bitcoin', 'BTC', 'CitreaTestnet/BTC',
    '0x...', 18, 1, 1, @BitcoinPriceRuleId  -- Same price rule!
);
```

#### Option B: TypeORM Migration
Run the migration:
```bash
npm run migration:run
```

### 3. Contract Address Configuration
Replace `0x...` with the actual wrapped BTC contract address on CitreaTestnet:
1. Find the wrapped BTC token contract on CitreaTestnet
2. Update the `chainId` field in the asset table
3. Verify the decimals (usually 8 or 18 for wrapped BTC)

### 4. Wallet Funding
Before processing transactions:
1. **Fund with native tokens** for gas fees
2. **Fund with BTC** for payouts

```bash
# Check wallet balance
curl https://rpc.testnet.citrea.xyz \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["YOUR_WALLET_ADDRESS", "latest"],"id":1}'
```

### 5. Verify Setup

#### Check Asset Configuration
```sql
-- Verify both Bitcoin and CitreaTestnet BTC use same price rule
SELECT 
    a.blockchain,
    a.symbol,
    a.name,
    a.priceRuleId,
    pr.priceSource,
    pr.currentPrice
FROM asset a
JOIN price_rule pr ON a.priceRuleId = pr.id
WHERE a.symbol = 'BTC'
ORDER BY a.blockchain;
```

Expected result:
| blockchain | symbol | priceRuleId | priceSource | currentPrice |
|------------|--------|-------------|-------------|--------------|
| Bitcoin | BTC | 123 | Binance:... | 95000 |
| CitreaTestnet | BTC | 123 | Binance:... | 95000 |

**Note: Both should have the SAME priceRuleId!**

### 6. Test Transaction

Test a small BTC purchase:
```typescript
// Example buy request
POST /v1/buy
{
  "amount": 0.0001,
  "asset": "BTC",
  "blockchain": "CitreaTestnet",
  "address": "0x..."
}
```

## Important Notes

### Price Consistency
- CitreaTestnet BTC shares the exact same PriceRule as native Bitcoin
- Price updates affect both assets simultaneously
- No need for separate price configuration

### Liquidity Management
- Liquidity rules may differ between chains
- Monitor CitreaTestnet BTC balance separately
- Consider bridge fees when rebalancing

### Gas Considerations
- CitreaTestnet uses different gas tokens than Bitcoin
- Ensure sufficient gas for transactions
- Monitor gas prices on CitreaTestnet

## Troubleshooting

### "Asset not found" Error
- Verify asset is in database with correct blockchain name
- Check uniqueName is "CitreaTestnet/BTC"

### "No price available" Error
- Ensure Bitcoin has a valid price rule
- Verify price rule is active and updating

### "Insufficient balance" Error
- Check wallet has enough BTC on CitreaTestnet
- Verify wallet has gas for transaction fees

### Transaction Failures
- Verify contract address is correct
- Check decimals configuration
- Ensure RPC endpoint is accessible

## Monitoring

Monitor CitreaTestnet BTC operations:
```sql
-- Recent CitreaTestnet BTC transactions
SELECT TOP 10 
    bc.id,
    bc.status,
    bc.inputAmount,
    bc.outputAmount,
    bc.created
FROM buy_crypto bc
JOIN asset a ON bc.assetId = a.id
WHERE a.blockchain = 'CitreaTestnet' 
  AND a.symbol = 'BTC'
ORDER BY bc.created DESC;

-- Check price updates
SELECT 
    pr.id,
    pr.priceAsset,
    pr.currentPrice,
    pr.priceTimestamp,
    DATEDIFF(SECOND, pr.priceTimestamp, GETDATE()) as age_seconds
FROM price_rule pr
JOIN asset a ON a.priceRuleId = pr.id
WHERE a.blockchain IN ('Bitcoin', 'CitreaTestnet')
  AND a.symbol = 'BTC';
```

## Architecture Benefits

Using the same PriceRule for both Bitcoin and CitreaTestnet BTC provides:

1. **Price Consistency**: No arbitrage opportunities due to price differences
2. **Simplified Management**: Single price configuration to maintain
3. **Reduced Complexity**: No need for cross-chain price synchronization
4. **Better UX**: Users see consistent BTC prices regardless of chain

## Next Steps

1. ✅ Asset registered with shared price rule
2. ✅ Payout infrastructure configured
3. ⏳ Test small transactions
4. ⏳ Monitor price updates
5. ⏳ Set up liquidity management rules
6. ⏳ Configure minimum/maximum limits
7. ⏳ Production deployment