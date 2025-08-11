# Citrea Testnet PR Review - Fix Tracker

## Pull Request: #2336 - "add Citrea Testnet"
**Reviewer:** davidleomay  
**Status:** Open  
**Created:** 2025-08-06  

---

## 📋 Review Issues Checklist

### 🔴 Critical Issues (Must Fix)

#### 1. ✅ Type-Definition fehlt für GoldskyService
- **File:** `src/integration/blockchain/shared/evm/evm-client.ts:55`
- **Issue:** `protected readonly goldskyService: any;`
- **Fix Applied:** Imported GoldskyService and replaced `any` with proper type
- **Status:** ✅ Fixed

#### 2. ✅ Null-Safety: Token Strategy getForwardAddress
- **File:** `src/subdomains/supporting/payin/strategies/send/impl/citrea-testnet-token.strategy.ts:24-26`
- **Issue:** `citreaTestnet` cannot be null - uses optional chaining with fallback
- **Fix Applied:** Added validation check, throws descriptive error if config is missing
- **Status:** ✅ Fixed

#### 3. ✅ Null-Safety: Coin Strategy getForwardAddress  
- **File:** `src/subdomains/supporting/payin/strategies/send/impl/citrea-testnet-coin.strategy.ts:24-26`
- **Issue:** `citreaTestnet` cannot be null - uses optional chaining with fallback
- **Fix Applied:** Added validation check, throws descriptive error if config is missing
- **Status:** ✅ Fixed

---

### 🟡 TODO Items (Incomplete Implementation)

#### 4. ✅ Fee Asset not implemented (prepare strategy)
- **File:** `src/subdomains/supporting/payout/strategies/prepare/impl/citrea-testnet.strategy.ts:19-22`
- **Method:** `getFeeAsset()`
- **Issue:** Returns `undefined` - native CitreaTestnet token must be configured
- **Fix Applied:** Added `getCitreaTestnetCoin()` method to AssetService and updated strategy
- **Status:** ✅ Fixed

#### 5. ✅ Gas calculation hardcoded (token payout)
- **File:** `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-token.strategy.ts:34-38`
- **Method:** `getCurrentGasForTransaction()`
- **Issue:** Hardcoded value (0.002) 
- **Fix Applied:** Now uses `citreaTestnetService.getCurrentGasForTokenTransaction()`
- **Status:** ✅ Fixed

#### 6. ✅ Fee Asset not implemented (token payout)
- **File:** `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-token.strategy.ts:40-44`
- **Method:** `getFeeAsset()`
- **Issue:** Returns `undefined` - native CitreaTestnet token for gas fees missing
- **Fix Applied:** Now returns `assetService.getCitreaTestnetCoin()`
- **Status:** ✅ Fixed

#### 7. ✅ Gas calculation hardcoded (coin payout)
- **File:** `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-coin.strategy.ts:34-38`
- **Method:** `getCurrentGasForTransaction()`
- **Issue:** Hardcoded value (0.001)
- **Fix Applied:** Now uses `citreaTestnetService.getCurrentGasForCoinTransaction()`
- **Status:** ✅ Fixed

#### 8. ✅ Fee Asset not implemented (coin payout)
- **File:** `src/subdomains/supporting/payout/strategies/payout/impl/citrea-testnet-coin.strategy.ts:40-44`
- **Method:** `getFeeAsset()`
- **Issue:** Returns `undefined` - native CitreaTestnet token missing
- **Fix Applied:** Now returns `assetService.getCitreaTestnetCoin()`
- **Status:** ✅ Fixed

---

## 📝 Additional Requirements from Comments

### Database Setup
- [ ] Register cBTC as native COIN asset in database
- [ ] Enable trading flags (buyable: true, sellable: true)
- [ ] Configure price rule (use Bitcoin price tracking)

### Environment Variables Required
```bash
CITREA_TESTNET_WALLET_ADDRESS=0x...
CITREA_TESTNET_WALLET_PRIVATE_KEY=...
CITREA_TESTNET_GATEWAY_URL=https://rpc.testnet.citrea.xyz
CITREA_TESTNET_API_KEY=
CITREA_TESTNET_CHAIN_ID=5115
CITREA_TESTNET_GOLDSKY_SUBGRAPH_URL= # Optional for transaction history
```

---

## 🎯 Fix Strategy

### Phase 1: Critical Fixes
1. Create GoldskyService interface
2. Fix null-safety issues in PayIn strategies
3. Ensure config validation

### Phase 2: Asset Configuration  
1. Create cBTC asset migration
2. Implement getFeeAsset methods
3. Test asset retrieval

### Phase 3: Gas Optimization
1. Implement dynamic gas calculation
2. Add gas price oracle integration
3. Test with real transactions

### Phase 4: Testing & Documentation
1. Run integration tests
2. Update documentation
3. Add example configurations

---

## 📊 Progress Tracking

**Total Issues:** 8  
**Fixed:** 8  
**In Progress:** 0  
**Pending:** 0  

**Completion:** 100% ✅

---

## 🔄 Updates Log

### 2025-08-11
- Initial review issues documented
- Fix strategy defined
- Checklist created
- All 8 issues fixed:
  - Type-safety for GoldskyService
  - Null-safety for PayIn strategies
  - Fee Asset implementations
  - Dynamic gas calculations
- Added `getCitreaTestnetCoin()` method to AssetService

---

## Notes

- All fee asset methods should return the native cBTC asset once it's properly configured in the database
- Gas calculations should use dynamic pricing from the RPC endpoint
- Config validation should happen at startup to prevent runtime null issues
- Consider adding integration tests for all new strategies