# CitreaTestnet Integration Checklist

## ✅ Completed Components

### Core Infrastructure
- [x] **Blockchain Enum** - Added `CITREA_TESTNET` to blockchain.enum.ts
- [x] **Client Implementation** - Created CitreaTestnetClient extending EvmClient
- [x] **Service Implementation** - Created CitreaTestnetService extending EvmService
- [x] **Module Setup** - Created CitreaTestnetModule with proper imports/exports
- [x] **Configuration** - Added citreaTestnet config section with environment variables
- [x] **Chain ID Mapping** - Added CitreaTestnet (5115) to EvmUtil

### PayIn Infrastructure (Incoming Payments)
- [x] **PayIn Service** - Created PayInCitreaTestnetService
- [x] **Register Strategy** - Created CitreaTestnetStrategy for transaction registration
- [x] **Send Strategies** - Created CitreaTestnetCoinStrategy and CitreaTestnetTokenStrategy
- [x] **Module Registration** - Added all strategies to PayInModule

### PayOut Infrastructure (Outgoing Payments)
- [x] **PayOut Service** - Created PayoutCitreaTestnetService
- [x] **PayOut Strategies** - Created payout strategies for coin and token
- [x] **Prepare Strategy** - Created CitreaTestnetStrategy for transaction preparation
- [x] **Module Registration** - Added all strategies to PayoutModule

### Integration Points
- [x] **Blockchain Module** - Registered CitreaTestnetModule
- [x] **Blockchain Registry** - Added CitreaTestnet to BlockchainRegistryService
- [x] **Alchemy Mapper** - Added note that CitreaTestnet uses direct RPC (no Alchemy)

### Documentation
- [x] **Setup Guide** - Created CITREA_TESTNET_SETUP.md
- [x] **SQL Scripts** - Created citrea-testnet-setup.sql for asset registration
- [x] **TypeORM Migration** - Created citrea-testnet-btc-asset.seed.ts
- [x] **ENV Template** - Created .env.citrea-testnet.example
- [x] **This Checklist** - Complete integration checklist

## ⏳ Required Manual Steps

### 1. Environment Configuration
```bash
# Add to .env file:
CITREA_TESTNET_WALLET_ADDRESS=0x...
CITREA_TESTNET_WALLET_PRIVATE_KEY=...
CITREA_TESTNET_GATEWAY_URL=https://rpc.testnet.citrea.xyz
CITREA_TESTNET_CHAIN_ID=5115
```

### 2. Database Setup
Run ONE of these options:

**Option A: SQL Script**
```sql
-- Execute citrea-testnet-setup.sql
-- This will create BTC asset with same price rule as Bitcoin
```

**Option B: TypeORM Migration**
```bash
npm run migration:run
```

### 3. Asset Configuration
- [ ] Find wrapped BTC contract address on CitreaTestnet
- [ ] Update chainId field in asset table with actual contract address
- [ ] Verify decimals (usually 8 or 18 for wrapped BTC)

### 4. Wallet Funding
- [ ] Fund wallet with native CitreaTestnet tokens for gas
- [ ] Fund wallet with wrapped BTC for payouts
- [ ] Verify balance through RPC calls

### 5. Testing
- [ ] Test small BTC purchase on CitreaTestnet
- [ ] Verify price matches Bitcoin price
- [ ] Test payout functionality
- [ ] Monitor transaction fees

## ⚠️ Known Limitations

### Missing Alchemy Features
CitreaTestnet doesn't have Alchemy support, which means:
- No webhook notifications for incoming transactions
- No asset transfer history API
- No token balance batch queries
- Manual transaction monitoring required

### Workarounds Needed
1. **Transaction History**: Implement polling or use CitreaTestnet-specific APIs
2. **Token Balances**: Use direct contract calls instead of Alchemy batch API
3. **Webhooks**: Set up custom monitoring solution or use CitreaTestnet events

## 🔍 Verification Commands

### Check Asset Configuration
```sql
SELECT a.*, pr.priceSource, pr.currentPrice
FROM asset a
LEFT JOIN price_rule pr ON a.priceRuleId = pr.id
WHERE a.blockchain = 'CitreaTestnet';
```

### Test RPC Connection
```bash
curl https://rpc.testnet.citrea.xyz \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

### Check Wallet Balance
```bash
curl https://rpc.testnet.citrea.xyz \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["YOUR_WALLET_ADDRESS", "latest"],"id":1}'
```

## 📊 Architecture Summary

### Design Decisions
1. **Shared Price Rule**: CitreaTestnet BTC uses same PriceRule as Bitcoin for consistency
2. **EVM Architecture**: CitreaTestnet treated as EVM-compatible chain
3. **Direct RPC**: No Alchemy intermediary, direct connection to CitreaTestnet RPC
4. **Token Type**: BTC implemented as wrapped token (ERC-20) on CitreaTestnet

### Benefits
- Price consistency across chains
- Reusable EVM infrastructure
- Simplified maintenance
- Standard token operations

### Trade-offs
- No Alchemy features (webhooks, history)
- Manual monitoring required
- Additional RPC endpoint to maintain

## 🚀 Production Readiness

Before going to production:
1. [ ] Complete all manual steps above
2. [ ] Implement transaction monitoring solution
3. [ ] Set up proper logging and alerting
4. [ ] Configure rate limits for RPC calls
5. [ ] Test failover scenarios
6. [ ] Document operational procedures
7. [ ] Set up liquidity management rules
8. [ ] Configure minimum/maximum transaction limits

## 📝 Notes

- CitreaTestnet is a Bitcoin L2 solution with EVM compatibility
- Uses Chain ID 5115
- RPC endpoint: https://rpc.testnet.citrea.xyz
- Requires wrapped BTC for token operations
- Gas paid in native CitreaTestnet tokens