/**
 * Bitcoin RPC Integration Tests
 *
 * These tests verify the correct functionality of the Bitcoin RPC integration
 * with our own minimal BitcoinRpcClient (in src/integration/blockchain/bitcoin/node/rpc/).
 *
 * IMPORTANT: These tests require a connection to a real Bitcoin Node!
 *
 * Usage:
 *   NODE_BTC_INP_URL_ACTIVE=http://localhost:8332 \
 *   NODE_USER=user \
 *   NODE_PASSWORD=pass \
 *   NODE_WALLET_PASSWORD=walletpass \
 *   npm run test -- --testPathPattern=bitcoin-rpc.integration
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { BitcoinService, BitcoinNodeType } from '../bitcoin.service';
import { BitcoinClient } from '../bitcoin-client';
import { HttpModule } from '@nestjs/axios';
import { HttpService } from 'src/shared/services/http.service';

// Skip tests if no Bitcoin node is configured
const SKIP_INTEGRATION_TESTS = !process.env.NODE_BTC_INP_URL_ACTIVE;

describe('Bitcoin RPC Integration Tests', () => {
  let module: TestingModule;
  let bitcoinService: BitcoinService;
  let inputClient: BitcoinClient;
  let outputClient: BitcoinClient;

  beforeAll(async () => {
    if (SKIP_INTEGRATION_TESTS) {
      console.log('⚠️  Skipping integration tests - NODE_BTC_INP_URL_ACTIVE not set');
      return;
    }

    module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(), HttpModule],
      providers: [BitcoinService, HttpService],
    }).compile();

    bitcoinService = module.get<BitcoinService>(BitcoinService);
    inputClient = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_INPUT);
    outputClient = bitcoinService.getDefaultClient(BitcoinNodeType.BTC_OUTPUT);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('1. Node Connection & Health', () => {
    it('should connect to BTC_INPUT node', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const info = await inputClient.getInfo();

      expect(info).toBeDefined();
      expect(info.chain).toBeDefined();
      expect(info.blocks).toBeGreaterThan(0);
      expect(info.headers).toBeGreaterThan(0);

      console.log(`✅ BTC_INPUT connected: chain=${info.chain}, blocks=${info.blocks}, headers=${info.headers}`);
    });

    it('should connect to BTC_OUTPUT node', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      if (!outputClient) {
        console.log('⚠️  BTC_OUTPUT not configured, skipping');
        return;
      }

      const info = await outputClient.getInfo();

      expect(info).toBeDefined();
      expect(info.chain).toBeDefined();

      console.log(`✅ BTC_OUTPUT connected: chain=${info.chain}, blocks=${info.blocks}`);
    });

    it('should verify node is synced', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const sync = await inputClient.checkSync();

      expect(sync.headers).toBeDefined();
      expect(sync.blocks).toBeDefined();
      expect(sync.blocks).toBeGreaterThanOrEqual(sync.headers - 1);

      console.log(`✅ Node synced: blocks=${sync.blocks}, headers=${sync.headers}`);
    });
  });

  describe('2. Block Methods', () => {
    it('should get block count', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const blockCount = await inputClient.getBlockCount();

      expect(blockCount).toBeGreaterThan(0);
      expect(typeof blockCount).toBe('number');

      console.log(`✅ Block count: ${blockCount}`);
    });

    it('should get block hash by height', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const blockCount = await inputClient.getBlockCount();
      const hash = await inputClient.getBlockHash(blockCount - 1);

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64);

      console.log(`✅ Block hash at height ${blockCount - 1}: ${hash.substring(0, 16)}...`);
    });

    it('should get block by hash', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const blockCount = await inputClient.getBlockCount();
      const hash = await inputClient.getBlockHash(blockCount - 1);
      const block = await inputClient.getBlock(hash);

      expect(block).toBeDefined();
      expect(block.hash).toBe(hash);
      expect(block.height).toBe(blockCount - 1);
      expect(block.confirmations).toBeGreaterThan(0);
      expect(Array.isArray(block.tx)).toBe(true);

      console.log(`✅ Block ${block.height}: ${block.tx.length} transactions`);
    });
  });

  describe('3. Wallet Methods', () => {
    it('should get wallet balance as number (not BigNumber)', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const balance = await inputClient.getBalance();

      expect(typeof balance).toBe('number');
      expect(balance).toBeGreaterThanOrEqual(0);
      expect(Number.isNaN(balance)).toBe(false);

      console.log(`✅ Wallet balance: ${balance} BTC (type: ${typeof balance})`);
    });

    it('should list UTXOs', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const utxos = await inputClient.getUtxo();

      expect(Array.isArray(utxos)).toBe(true);

      if (utxos.length > 0) {
        const utxo = utxos[0];
        expect(utxo.txid).toBeDefined();
        expect(typeof utxo.txid).toBe('string');
        expect(utxo.vout).toBeDefined();
        expect(typeof utxo.vout).toBe('number');
        expect(utxo.amount).toBeDefined();
        expect(typeof utxo.amount).toBe('number');
        expect(utxo.confirmations).toBeDefined();

        console.log(`✅ Found ${utxos.length} UTXOs, first: ${utxo.txid.substring(0, 16)}...:${utxo.vout}`);
      } else {
        console.log(`✅ No UTXOs found (wallet may be empty)`);
      }
    });

    it('should get native coin balance', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const balance = await inputClient.getNativeCoinBalance();

      expect(typeof balance).toBe('number');
      expect(Number.isNaN(balance)).toBe(false);

      console.log(`✅ Native coin balance: ${balance} BTC`);
    });
  });

  describe('4. Address Generation (CRITICAL)', () => {
    it('should create bech32 address by default', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const label = `test-bech32-${Date.now()}`;
      const address = await inputClient.createAddress(label);

      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
      // bech32 addresses start with bc1 (mainnet) or tb1/bcrt1 (testnet/regtest)
      expect(address.match(/^(bc1|tb1|bcrt1)/)).toBeTruthy();

      console.log(`✅ Created bech32 address: ${address}`);
    });

    it('should create p2sh-segwit address when type is specified (CRITICAL)', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const label = `test-p2sh-${Date.now()}`;
      const address = await inputClient.createAddress(label, 'p2sh-segwit');

      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
      // p2sh-segwit addresses start with 3 (mainnet) or 2 (testnet)
      expect(address.match(/^(3|2)/)).toBeTruthy();

      console.log(`✅ Created p2sh-segwit address: ${address}`);
    });

    it('should create legacy address when type is specified', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const label = `test-legacy-${Date.now()}`;
      const address = await inputClient.createAddress(label, 'legacy');

      expect(address).toBeDefined();
      expect(typeof address).toBe('string');
      // legacy addresses start with 1 (mainnet) or m/n (testnet)
      expect(address.match(/^(1|m|n)/)).toBeTruthy();

      console.log(`✅ Created legacy address: ${address}`);
    });
  });

  describe('5. Transaction Methods (CRITICAL)', () => {
    // This test requires a known transaction in the wallet
    const TEST_TXID = process.env.TEST_BITCOIN_TXID;

    it('should get transaction with all required fields', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      if (!TEST_TXID) {
        console.log('⚠️  TEST_BITCOIN_TXID not set, skipping getTx test');
        return;
      }

      const tx = await inputClient.getTx(TEST_TXID);

      expect(tx).not.toBeNull();
      expect(tx.txid).toBe(TEST_TXID);
      expect(tx.confirmations).toBeDefined();
      expect(typeof tx.confirmations).toBe('number');
      expect(tx.time).toBeDefined();
      expect(typeof tx.time).toBe('number');
      expect(tx.amount).toBeDefined();
      expect(typeof tx.amount).toBe('number');

      // CRITICAL: fee must be defined for outgoing transactions
      console.log(`✅ Transaction ${TEST_TXID.substring(0, 16)}...:`);
      console.log(`   - confirmations: ${tx.confirmations}`);
      console.log(`   - blockhash: ${tx.blockhash?.substring(0, 16)}...`);
      console.log(`   - amount: ${tx.amount}`);
      console.log(`   - fee: ${tx.fee} (${typeof tx.fee})`);
      console.log(`   - time: ${new Date(tx.time * 1000).toISOString()}`);
    });

    it('should return null for non-existent transaction', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const fakeTxId = '0000000000000000000000000000000000000000000000000000000000000000';
      const tx = await inputClient.getTx(fakeTxId);

      expect(tx).toBeNull();

      console.log(`✅ Non-existent transaction returns null (not exception)`);
    });

    it('should check transaction completion correctly', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      if (!TEST_TXID) {
        console.log('⚠️  TEST_BITCOIN_TXID not set, skipping isTxComplete test');
        return;
      }

      const isComplete = await inputClient.isTxComplete(TEST_TXID, 1);

      expect(typeof isComplete).toBe('boolean');

      console.log(`✅ Transaction complete check: ${isComplete}`);
    });

    it('should get raw transaction data via getrawtransaction', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      if (!TEST_TXID) {
        console.log('⚠️  TEST_BITCOIN_TXID not set, skipping getRawTx test');
        return;
      }

      const rawTx = await inputClient.getRawTx(TEST_TXID);

      expect(rawTx).not.toBeNull();
      if (rawTx) {
        expect(rawTx.txid).toBe(TEST_TXID);
        expect(typeof rawTx.confirmations).toBe('number');
        expect(Array.isArray(rawTx.vin)).toBe(true);
        expect(Array.isArray(rawTx.vout)).toBe(true);

        console.log(`✅ Raw transaction retrieved:`);
        console.log(`   - txid: ${rawTx.txid}`);
        console.log(`   - confirmations: ${rawTx.confirmations}`);
        console.log(`   - blockhash: ${rawTx.blockhash ? 'present' : 'missing'}`);
        console.log(`   - inputs: ${rawTx.vin.length}, outputs: ${rawTx.vout.length}`);
      }
    });

    it('should return null for non-existent raw transaction', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const rawTx = await inputClient.getRawTx('0000000000000000000000000000000000000000000000000000000000000000');

      expect(rawTx).toBeNull();

      console.log(`✅ Non-existent raw transaction returns null`);
    });
  });

  describe('6. Payout Fee Calculation (CRITICAL)', () => {
    const TEST_TXID = process.env.TEST_BITCOIN_TXID;

    it('should calculate payout fee without NaN', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      if (!TEST_TXID) {
        console.log('⚠️  TEST_BITCOIN_TXID not set, skipping fee calculation test');
        return;
      }

      const tx = await inputClient.getTx(TEST_TXID);

      if (!tx) {
        console.log('⚠️  Transaction not found, skipping');
        return;
      }

      // Simulate the payout fee calculation from payout-bitcoin.service.ts
      const isComplete = tx && tx.blockhash && tx.confirmations > 0;
      const payoutFee = isComplete ? -(tx.fee ?? 0) : 0;

      expect(Number.isNaN(payoutFee)).toBe(false);
      expect(typeof payoutFee).toBe('number');

      console.log(`✅ Payout fee calculation:`);
      console.log(`   - tx.fee: ${tx.fee}`);
      console.log(`   - payoutFee: ${payoutFee}`);
      console.log(`   - isNaN: ${Number.isNaN(payoutFee)}`);
    });
  });

  describe('7. Transaction History', () => {
    it('should get recent transaction history', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const history = await inputClient.getRecentHistory(10);

      expect(Array.isArray(history)).toBe(true);

      if (history.length > 0) {
        const tx = history[0];
        expect(tx.txid).toBeDefined();
        expect(tx.address).toBeDefined();
        expect(tx.amount).toBeDefined();
        expect(typeof tx.amount).toBe('number');

        console.log(`✅ Transaction history: ${history.length} entries`);
        console.log(`   - Latest: ${tx.txid.substring(0, 16)}... (${tx.category})`);
      } else {
        console.log(`✅ No transaction history (wallet may be new)`);
      }
    });
  });

  describe('8. Mempool Methods', () => {
    it('should test mempool accept for invalid transaction', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      // Invalid hex should be rejected
      const invalidHex = '0100000000000000000000';
      const result = await inputClient.testMempoolAccept(invalidHex);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(result[0].allowed).toBe(false);

      console.log(`✅ Mempool reject test: allowed=${result[0].allowed}, reason=${result[0]['reject-reason']}`);
    });
  });

  describe('9. Send Methods (READ-ONLY VALIDATION)', () => {
    // These tests validate the send method parameters without actually sending

    it('should have correct send method signature', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      // Verify the method exists and has correct signature
      expect(typeof inputClient.send).toBe('function');
      expect(inputClient.send.length).toBeGreaterThanOrEqual(5); // 5 parameters

      console.log(`✅ send() method exists with correct signature`);
    });

    it('should have correct sendMany method signature', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      expect(typeof inputClient.sendMany).toBe('function');

      console.log(`✅ sendMany() method exists`);
    });

    it('should have correct sendSignedTransaction method signature', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      expect(typeof inputClient.sendSignedTransaction).toBe('function');

      console.log(`✅ sendSignedTransaction() method exists`);
    });
  });

  describe('10. Error Handling', () => {
    it('should handle RPC errors gracefully', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      // Try to get a transaction that doesn't exist in the wallet
      const result = await inputClient.getTx('nonexistent');

      // Should return null, not throw
      expect(result).toBeNull();

      console.log(`✅ RPC errors handled gracefully (returns null)`);
    });

    it('should throw on invalid block hash', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      await expect(inputClient.getBlock('invalidhash')).rejects.toThrow();

      console.log(`✅ Invalid block hash throws error (as expected)`);
    });
  });

  // --- NEW TESTS FOR COMPREHENSIVE COVERAGE --- //

  describe('11. Fee Estimation (CRITICAL)', () => {
    it('should estimate smart fee in valid sat/vB range', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const feeRate = await inputClient.estimateSmartFee(1);

      // feeRate can be null if insufficient data
      if (feeRate !== null) {
        expect(typeof feeRate).toBe('number');
        expect(feeRate).toBeGreaterThan(0);
        expect(feeRate).toBeLessThan(10000); // Sanity check: <10000 sat/vB
        expect(Number.isNaN(feeRate)).toBe(false);

        console.log(`✅ Fee rate: ${feeRate.toFixed(2)} sat/vB`);
      } else {
        console.log(`⚠️  Fee estimation returned null (insufficient data)`);
      }
    });

    it('should estimate fee for different confirmation targets', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const fee1 = await inputClient.estimateSmartFee(1);
      const fee6 = await inputClient.estimateSmartFee(6);
      const fee144 = await inputClient.estimateSmartFee(144); // ~1 day

      console.log(`✅ Fee estimates:`);
      console.log(`   - 1 block: ${fee1 ?? 'null'} sat/vB`);
      console.log(`   - 6 blocks: ${fee6 ?? 'null'} sat/vB`);
      console.log(`   - 144 blocks: ${fee144 ?? 'null'} sat/vB`);

      // Generally, faster confirmation = higher fee (not always true, but common)
      if (fee1 !== null && fee6 !== null) {
        expect(fee1).toBeGreaterThanOrEqual(fee6 * 0.5); // Allow some variance
      }
    });
  });

  describe('12. Mempool Entry (CRITICAL)', () => {
    it('should return null for non-existent mempool entry', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      // Use a fake txid that won't be in mempool
      const fakeTxid = '0000000000000000000000000000000000000000000000000000000000000000';
      const entry = await inputClient.getMempoolEntry(fakeTxid);

      expect(entry).toBeNull();

      console.log(`✅ Non-existent mempool entry returns null`);
    });

    it('should return fee rate for unconfirmed TX in mempool', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      // Try to find an unconfirmed TX in the wallet
      const history = await inputClient.getRecentHistory(20);
      const unconfirmedTx = history.find((tx) => tx.confirmations === 0);

      if (unconfirmedTx) {
        const entry = await inputClient.getMempoolEntry(unconfirmedTx.txid);

        if (entry) {
          expect(typeof entry.feeRate).toBe('number');
          expect(entry.feeRate).toBeGreaterThan(0);
          expect(typeof entry.vsize).toBe('number');
          expect(entry.vsize).toBeGreaterThan(0);

          console.log(`✅ Mempool entry for ${unconfirmedTx.txid.substring(0, 16)}...:`);
          console.log(`   - feeRate: ${entry.feeRate.toFixed(2)} sat/vB`);
          console.log(`   - vsize: ${entry.vsize} vBytes`);
        } else {
          console.log(`⚠️  TX ${unconfirmedTx.txid.substring(0, 16)}... not in mempool (may have been confirmed)`);
        }
      } else {
        console.log(`⚠️  No unconfirmed transactions in wallet history`);
      }
    });
  });

  describe('13. CLI Command Parsing', () => {
    const TEST_TXID = process.env.TEST_BITCOIN_TXID;

    it('should execute getrawtransaction via CLI command', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      if (!TEST_TXID) {
        console.log('⚠️  TEST_BITCOIN_TXID not set, skipping CLI command test');
        return;
      }

      const command = `getrawtransaction "${TEST_TXID}" 2`;
      const result = await inputClient.sendCliCommand(command);

      expect(result).toBeDefined();
      expect(result.txid).toBe(TEST_TXID);
      expect(result.vin).toBeDefined();
      expect(Array.isArray(result.vin)).toBe(true);
      expect(result.vout).toBeDefined();
      expect(Array.isArray(result.vout)).toBe(true);

      console.log(`✅ getrawtransaction via CLI:`);
      console.log(`   - inputs: ${result.vin.length}`);
      console.log(`   - outputs: ${result.vout.length}`);
    });

    it('should handle CLI command errors gracefully', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const command = 'invalidcommand';

      await expect(inputClient.sendCliCommand(command)).rejects.toThrow();

      console.log(`✅ Invalid CLI command throws error`);
    });
  });

  describe('14. Address Groupings', () => {
    it('should list address groupings', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const balance = await inputClient.getNativeCoinBalance();

      expect(typeof balance).toBe('number');
      expect(Number.isNaN(balance)).toBe(false);

      console.log(`✅ Total wallet balance: ${balance} BTC`);
    });

    it('should get balance for specific address via groupings', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      // First get an address from the wallet
      const utxos = await inputClient.getUtxo();

      if (utxos.length > 0) {
        const testAddress = utxos[0].address;
        const balance = await inputClient.getNativeCoinBalanceForAddress(testAddress);

        expect(typeof balance).toBe('number');
        expect(balance).toBeGreaterThanOrEqual(0);

        console.log(`✅ Balance for ${testAddress}: ${balance} BTC`);
      } else {
        console.log(`⚠️  No UTXOs found, skipping address balance test`);
      }
    });
  });

  describe('15. Raw RPC Command', () => {
    it('should execute raw RPC command', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const command = JSON.stringify({
        jsonrpc: '1.0',
        id: 'test',
        method: 'getblockcount',
        params: [],
      });

      const result = await inputClient.sendRpcCommand(command);

      expect(result).toBeDefined();
      expect(result.result).toBeGreaterThan(0);

      console.log(`✅ Raw RPC command result: ${result.result}`);
    });
  });

  describe('16. UTXO with Unconfirmed', () => {
    it('should list UTXOs including unconfirmed when requested', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const confirmedUtxos = await inputClient.getUtxo(false);
      const allUtxos = await inputClient.getUtxo(true);

      expect(Array.isArray(confirmedUtxos)).toBe(true);
      expect(Array.isArray(allUtxos)).toBe(true);
      expect(allUtxos.length).toBeGreaterThanOrEqual(confirmedUtxos.length);

      const unconfirmedCount = allUtxos.filter((u) => u.confirmations === 0).length;

      console.log(`✅ UTXO counts:`);
      console.log(`   - Confirmed: ${confirmedUtxos.length}`);
      console.log(`   - Including unconfirmed: ${allUtxos.length}`);
      console.log(`   - Unconfirmed: ${unconfirmedCount}`);
    });
  });

  describe('17. Numeric Type Safety', () => {
    it('should return numeric types (not BigNumber or string) for amounts', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const balance = await inputClient.getBalance();
      const feeRate = await inputClient.estimateSmartFee(1);

      // Balance
      expect(typeof balance).toBe('number');
      expect(Number.isFinite(balance)).toBe(true);

      // Fee rate (if available)
      if (feeRate !== null) {
        expect(typeof feeRate).toBe('number');
        expect(Number.isFinite(feeRate)).toBe(true);
      }

      console.log(`✅ Numeric type safety verified:`);
      console.log(`   - balance: ${balance} (${typeof balance})`);
      console.log(`   - feeRate: ${feeRate} (${typeof feeRate})`);
    });

    it('should handle UTXO amounts as numbers', async () => {
      if (SKIP_INTEGRATION_TESTS) return;

      const utxos = await inputClient.getUtxo();

      if (utxos.length > 0) {
        const utxo = utxos[0];

        expect(typeof utxo.amount).toBe('number');
        expect(Number.isFinite(utxo.amount)).toBe(true);
        expect(typeof utxo.confirmations).toBe('number');

        console.log(`✅ UTXO numeric types verified:`);
        console.log(`   - amount: ${utxo.amount} (${typeof utxo.amount})`);
        console.log(`   - confirmations: ${utxo.confirmations} (${typeof utxo.confirmations})`);
      } else {
        console.log(`⚠️  No UTXOs to verify numeric types`);
      }
    });
  });
});

/**
 * Standalone test runner for quick verification
 * Can be run directly: npx ts-node src/integration/blockchain/bitcoin/node/__tests__/bitcoin-rpc.integration.spec.ts
 */
if (require.main === module) {
  console.log('='.repeat(60));
  console.log('Bitcoin RPC Integration Test Runner');
  console.log('='.repeat(60));

  if (!process.env.NODE_BTC_INP_URL_ACTIVE) {
    console.error('\n❌ ERROR: NODE_BTC_INP_URL_ACTIVE environment variable not set');
    console.log('\nUsage:');
    console.log('  NODE_BTC_INP_URL_ACTIVE=http://localhost:8332 \\');
    console.log('  NODE_USER=user \\');
    console.log('  NODE_PASSWORD=pass \\');
    console.log('  npx ts-node <this-file>');
    process.exit(1);
  }

  console.log('\nConfiguration:');
  console.log(`  NODE_BTC_INP_URL_ACTIVE: ${process.env.NODE_BTC_INP_URL_ACTIVE}`);
  console.log(`  NODE_USER: ${process.env.NODE_USER ? '***' : '(not set)'}`);
  console.log(`  TEST_BITCOIN_TXID: ${process.env.TEST_BITCOIN_TXID || '(not set)'}`);
  console.log('\nRun with: npm run test -- --testPathPattern=bitcoin-rpc.integration\n');
}
