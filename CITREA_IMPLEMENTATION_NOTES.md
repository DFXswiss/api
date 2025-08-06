# CitreaTestnet Implementation Notes

## Important: Alchemy Compatibility Issue

CitreaTestnet is **NOT supported by Alchemy SDK**, which means several features have limited functionality:

### Working Features ✅
- ✅ Native coin (cBTC) transfers
- ✅ ERC20 token transfers  
- ✅ Balance queries (using direct RPC calls)
- ✅ Smart contract interactions
- ✅ Gas estimation and transaction management

### Limited Features ⚠️
- ⚠️ **Transaction History**: Not available (returns empty arrays)
  - `getNativeCoinTransactions()` - returns []
  - `getERC20Transactions()` - returns []
- ⚠️ **Asset Transfers API**: Not available
- ⚠️ **Enhanced Transaction Monitoring**: Not available

### Implementation Details

1. **Custom Client Implementation**: 
   - `CitreaTestnetClient` extends `EvmClient` but overrides Alchemy-dependent methods
   - Uses direct ethers.js RPC calls instead of Alchemy SDK

2. **No AlchemyModule Dependency**:
   - `CitreaTestnetModule` does NOT import AlchemyModule
   - `CitreaTestnetService` does NOT inject AlchemyService

3. **Fallback Methods**:
   - Balance queries use `provider.getBalance()` directly
   - Token balances use ERC20 contract calls directly
   - Transaction history returns empty arrays with console warnings

### Production Considerations

Before deploying to production, consider:

1. **Transaction History**: 
   - Option A: Implement a custom indexer for CitreaTestnet
   - Option B: Use Citrea's own explorer API if available
   - Option C: Accept limited functionality for this testnet

2. **Monitoring**:
   - Set up alternative monitoring since Alchemy webhooks won't work
   - Consider using direct event listeners on the RPC endpoint

3. **Performance**:
   - Direct RPC calls may be slower than Alchemy's optimized endpoints
   - Consider implementing caching for frequently accessed data

### Testing Recommendations

1. Test all basic operations:
   ```bash
   # Send native cBTC
   # Send ERC20 tokens
   # Query balances
   ```

2. Verify error handling:
   - Test with invalid addresses
   - Test with insufficient funds
   - Test network connectivity issues

3. Monitor logs for warnings:
   - Watch for "Transaction history not available" warnings
   - These are expected and not errors

### Future Improvements

1. **If Alchemy adds Citrea support**:
   - Remove custom overrides in CitreaTestnetClient
   - Add CitreaTestnet to AlchemyNetworkMapper
   - Re-enable AlchemyModule dependency

2. **Alternative indexer integration**:
   - Research Citrea's native indexing solutions
   - Implement transaction history using alternative APIs

3. **Production readiness**:
   - Implement proper transaction history
   - Add comprehensive error handling
   - Set up monitoring and alerting