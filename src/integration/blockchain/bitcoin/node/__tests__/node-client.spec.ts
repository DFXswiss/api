/**
 * Unit Tests for NodeClient
 *
 * These tests verify the correct behavior of the NodeClient abstract class,
 * including URL parsing, fee rate conversion, wallet unlock, and retry logic.
 */

import { Currency } from '@uniswap/sdk-core';
import { HttpService } from 'src/shared/services/http.service';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { BlockchainTokenBalance } from '../../../shared/dto/blockchain-token-balance.dto';
import { BitcoinRpcClient } from '../rpc/bitcoin-rpc-client';
import { NodeClient } from '../node-client';

// Concrete implementation for testing
class TestNodeClient extends NodeClient {
  // Required abstract implementations
  get walletAddress(): string {
    return 'bc1qtestwalletaddress';
  }

  async getNativeCoinBalance(): Promise<number> {
    return this.getBalance();
  }

  async getNativeCoinBalanceForAddress(_address: string): Promise<number> {
    // Simple implementation for testing
    return 0;
  }

  async getToken(_asset: Asset): Promise<Currency> {
    throw new Error('Not implemented');
  }

  async getTokenBalance(_asset: Asset, _address?: string): Promise<number> {
    throw new Error('Not implemented');
  }

  async getTokenBalances(_assets: Asset[], _address?: string): Promise<BlockchainTokenBalance[]> {
    throw new Error('Not implemented');
  }

  async isTxComplete(txId: string, minConfirmations?: number): Promise<boolean> {
    const tx = await this.getTx(txId);
    return tx !== null && tx.blockhash !== undefined && tx.confirmations > (minConfirmations ?? 0);
  }

  async sendSignedTransaction(_hex: string): Promise<{ hash?: string; error?: { code: number; message: string } }> {
    throw new Error('Not implemented');
  }

  // Expose protected methods for testing
  public get testRpc(): BitcoinRpcClient {
    return this.rpc;
  }

  public testRoundAmount(amount: number): number {
    return this.roundAmount(amount);
  }

  public async testCallNode<T>(call: () => Promise<T>, unlock = false): Promise<T> {
    return this.callNode(call, unlock);
  }
}

// Mock Config
jest.mock('src/config/config', () => ({
  Config: {
    blockchain: {
      default: {
        user: 'testuser',
        password: 'testpass',
        walletPassword: 'walletpass123',
        allowUnconfirmedUtxos: true,
      },
    },
  },
}));

describe('NodeClient', () => {
  let mockHttpService: jest.Mocked<HttpService>;
  let mockRpcPost: jest.Mock;

  beforeEach(() => {
    mockRpcPost = jest.fn().mockResolvedValue({ result: null, error: null, id: 'test' });

    mockHttpService = {
      post: mockRpcPost,
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;
  });

  // --- URL Handling Tests --- //

  describe('URL Handling', () => {
    it('should use HTTP URL as provided', () => {
      const client = new TestNodeClient(mockHttpService, 'http://localhost:8332');

      expect(client.testRpc.getUrl()).toBe('http://localhost:8332');
    });

    it('should use HTTPS URL as provided', () => {
      const client = new TestNodeClient(mockHttpService, 'https://bitcoin.example.com:8443');

      expect(client.testRpc.getUrl()).toBe('https://bitcoin.example.com:8443');
    });

    it('should preserve URL with path', () => {
      const client = new TestNodeClient(mockHttpService, 'http://node.example.com:8332/wallet/default');

      expect(client.testRpc.getUrl()).toBe('http://node.example.com:8332/wallet/default');
    });
  });

  // --- Blockchain Methods Tests --- //

  describe('Blockchain Methods', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('getBlockCount() should return block height', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: 750000, error: null, id: 'test' });

      const result = await client.getBlockCount();

      expect(result).toBe(750000);
    });

    it('getInfo() should return blockchain info', async () => {
      const mockInfo = {
        chain: 'main',
        blocks: 750000,
        headers: 750000,
        bestblockhash: '000000000000000000...',
        verificationprogress: 1,
      };
      mockRpcPost.mockResolvedValueOnce({ result: mockInfo, error: null, id: 'test' });

      const result = await client.getInfo();

      expect(result.chain).toBe('main');
      expect(result.blocks).toBe(750000);
    });

    it('checkSync() should return headers and blocks when synced', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: { blocks: 750000, headers: 750000 },
        error: null,
        id: 'test',
      });

      const result = await client.checkSync();

      expect(result.headers).toBe(750000);
      expect(result.blocks).toBe(750000);
    });

    it('checkSync() should throw when not synced', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: { blocks: 749990, headers: 750000 },
        error: null,
        id: 'test',
      });

      await expect(client.checkSync()).rejects.toThrow('Node not in sync by 10 block(s)');
    });

    it('checkSync() should pass when only 1 block behind', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: { blocks: 749999, headers: 750000 },
        error: null,
        id: 'test',
      });

      const result = await client.checkSync();

      expect(result.blocks).toBe(749999);
    });

    it('getBlock(hash) should return block data', async () => {
      const mockBlock = {
        hash: '00000000000000000001...',
        height: 750000,
        confirmations: 6,
        time: 1680000000,
        tx: ['tx1', 'tx2'],
      };
      mockRpcPost.mockResolvedValueOnce({ result: mockBlock, error: null, id: 'test' });

      const result = await client.getBlock('00000000000000000001...');

      expect(result.height).toBe(750000);
      expect(result.tx).toHaveLength(2);
    });

    it('getBlockHash(height) should return block hash', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: '00000000000000000001234567890abcdef',
        error: null,
        id: 'test',
      });

      const result = await client.getBlockHash(750000);

      expect(result).toBe('00000000000000000001234567890abcdef');
    });
  });

  // --- Transaction Methods Tests --- //

  describe('Transaction Methods', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('getTx(txId) should return transaction with mapped fields', async () => {
      const mockTx = {
        txid: 'abc123',
        blockhash: '00000000...',
        confirmations: 6,
        time: 1680000000,
        amount: -0.5,
        fee: -0.0001,
      };
      // First call is for wallet unlock (walletpassphrase)
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      // Second call is for gettransaction
      mockRpcPost.mockResolvedValueOnce({ result: mockTx, error: null, id: 'test' });

      const result = await client.getTx('abc123');

      expect(result).not.toBeNull();
      expect(result!.txid).toBe('abc123');
      expect(result!.confirmations).toBe(6);
      expect(result!.fee).toBe(-0.0001);
    });

    it('getTx(txId) should return null when transaction not found', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({
        result: null,
        error: { code: -5, message: 'Invalid or non-wallet transaction id' },
        id: 'test',
      });

      const result = await client.getTx('nonexistent');

      expect(result).toBeNull();
    });

    it('getTx(txId) should handle undefined fields gracefully', async () => {
      const mockTx = {
        txid: 'abc123',
        // No blockhash, confirmations, time, amount, or fee
      };
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({ result: mockTx, error: null, id: 'test' });

      const result = await client.getTx('abc123');

      expect(result).not.toBeNull();
      expect(result!.confirmations).toBe(0);
      expect(result!.time).toBe(0);
      expect(result!.amount).toBe(0);
      expect(result!.fee).toBeUndefined();
    });

    it('getRawTx(txId) should return raw transaction with confirmations', async () => {
      const mockRawTx = {
        txid: 'abc123',
        blockhash: '00000000...',
        confirmations: 6,
        time: 1680000000,
        vin: [],
        vout: [],
      };
      mockRpcPost.mockResolvedValueOnce({ result: mockRawTx, error: null, id: 'test' });

      const result = await client.getRawTx('abc123');

      expect(result).not.toBeNull();
      expect(result!.txid).toBe('abc123');
      expect(result!.confirmations).toBe(6);
      expect(result!.blockhash).toBe('00000000...');
    });

    it('getRawTx(txId) should return null when transaction not found', async () => {
      const error = new Error('No such mempool or blockchain transaction') as Error & { code: number };
      error.code = -5;
      mockRpcPost.mockRejectedValueOnce(error);

      const result = await client.getRawTx('nonexistent');

      expect(result).toBeNull();
    });
  });

  // --- Wallet Methods Tests --- //

  describe('Wallet Methods', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('createAddress(label, type) should create address with correct type', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' }); // unlock
      mockRpcPost.mockResolvedValueOnce({ result: 'bc1q...', error: null, id: 'test' });

      const result = await client.createAddress('test-label', 'bech32');

      expect(result).toBe('bc1q...');

      // Verify the getnewaddress call
      const calls = mockRpcPost.mock.calls;
      const getnewaddressCall = calls.find((call) => call[1].includes('getnewaddress'));
      expect(getnewaddressCall).toBeDefined();
      expect(getnewaddressCall![1]).toContain('"test-label"');
      expect(getnewaddressCall![1]).toContain('"bech32"');
    });

    it('createAddress(label) should default to bech32', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({ result: 'bc1q...', error: null, id: 'test' });

      await client.createAddress('test');

      const calls = mockRpcPost.mock.calls;
      const getnewaddressCall = calls.find((call) => call[1].includes('getnewaddress'));
      expect(getnewaddressCall![1]).toContain('"bech32"');
    });

    it('getUtxo() should return UTXO list', async () => {
      const mockUtxos = [
        { txid: 'abc', vout: 0, amount: 0.5, confirmations: 6 },
        { txid: 'def', vout: 1, amount: 1.0, confirmations: 3 },
      ];
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({ result: mockUtxos, error: null, id: 'test' });

      const result = await client.getUtxo();

      expect(result).toHaveLength(2);
      expect(result[0].amount).toBe(0.5);
    });

    it('getUtxo(true) should include unconfirmed UTXOs', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({ result: [], error: null, id: 'test' });

      await client.getUtxo(true);

      const calls = mockRpcPost.mock.calls;
      const listunspentCall = calls.find((call) => call[1].includes('listunspent'));
      // Should pass minconf=0 for unconfirmed
      expect(listunspentCall![1]).toContain('[0,');
    });

    it('getBalance() should return wallet balance (confirmed + unconfirmed)', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({
        result: { mine: { trusted: 1.5, untrusted_pending: 0.8, immature: 0.2 } },
        error: null,
        id: 'test',
      });

      const result = await client.getBalance();

      // Should return trusted + untrusted_pending (excluding immature coinbase)
      expect(result).toBe(2.3);
      expect(typeof result).toBe('number');
    });

    it('getBalance() should throw when balances.mine is null', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' });
      mockRpcPost.mockResolvedValueOnce({ result: {}, error: null, id: 'test' });

      await expect(client.getBalance()).rejects.toThrow('Failed to get wallet balances');
    });
  });

  // --- Fee Rate Conversion Tests (CRITICAL) --- //

  describe('Fee Rate Conversion (CRITICAL)', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('estimateSmartFee() should convert BTC/kvB to sat/vB', async () => {
      // Bitcoin Core returns feerate in BTC/kvB (BTC per 1000 virtual bytes)
      // 0.00001 BTC/kvB = 1 sat/vB
      mockRpcPost.mockResolvedValueOnce({
        result: { feerate: 0.0001, blocks: 1 }, // 0.0001 BTC/kvB = 10 sat/vB
        error: null,
        id: 'test',
      });

      const result = await client.estimateSmartFee(1);

      // Formula: feerate * 100000 = sat/vB
      // 0.0001 * 100000 = 10
      expect(result).toBe(10);
    });

    it('estimateSmartFee() should return null for negative feerate', async () => {
      // Bitcoin Core returns feerate: -1 when insufficient data
      mockRpcPost.mockResolvedValueOnce({
        result: { feerate: -1, blocks: 1 },
        error: null,
        id: 'test',
      });

      const result = await client.estimateSmartFee(1);

      expect(result).toBeNull();
    });

    it('estimateSmartFee() should return null for zero feerate', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: { feerate: 0, blocks: 1 },
        error: null,
        id: 'test',
      });

      const result = await client.estimateSmartFee(1);

      expect(result).toBeNull();
    });

    it('estimateSmartFee() should return null when feerate is undefined', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: { blocks: 1, errors: ['Insufficient data'] },
        error: null,
        id: 'test',
      });

      const result = await client.estimateSmartFee(1);

      expect(result).toBeNull();
    });

    it('getMempoolEntry() should convert fees.base to sat/vB', async () => {
      // fees.base is in BTC, vsize is in virtual bytes
      mockRpcPost.mockResolvedValueOnce({
        result: {
          vsize: 200,
          fees: { base: 0.00002 }, // 0.00002 BTC = 2000 satoshis
        },
        error: null,
        id: 'test',
      });

      const result = await client.getMempoolEntry('abc123');

      // feeRate = (fees.base * 100_000_000) / vsize
      // (0.00002 * 100_000_000) / 200 = 2000 / 200 = 10 sat/vB
      expect(result).not.toBeNull();
      expect(result!.feeRate).toBeCloseTo(10, 6); // Use toBeCloseTo for floating point
      expect(result!.vsize).toBe(200);
    });

    it('getMempoolEntry() should return null when TX not in mempool', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: null,
        error: { code: -5, message: 'Transaction not in mempool' },
        id: 'test',
      });

      const result = await client.getMempoolEntry('abc123');

      expect(result).toBeNull();
    });

    it('getMempoolEntry() should return null when fees.base is missing', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: { vsize: 200 },
        error: null,
        id: 'test',
      });

      const result = await client.getMempoolEntry('abc123');

      expect(result).toBeNull();
    });
  });

  // --- Wallet Unlock Tests --- //

  describe('Wallet Unlock', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('should call walletpassphrase before sensitive operations', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' }); // unlock
      mockRpcPost.mockResolvedValueOnce({ result: 'bc1q...', error: null, id: 'test' });

      await client.createAddress('test');

      const calls = mockRpcPost.mock.calls;
      expect(calls[0][1]).toContain('walletpassphrase');
      expect(calls[0][1]).toContain('"walletpass123"');
      expect(calls[0][1]).toContain('60'); // default timeout
    });

    it('should not throw when wallet unlock fails', async () => {
      mockRpcPost.mockResolvedValueOnce({
        result: null,
        error: { code: -15, message: 'Error: The wallet passphrase entered was incorrect.' },
        id: 'test',
      });
      mockRpcPost.mockResolvedValueOnce({ result: 'bc1q...', error: null, id: 'test' });

      // Should not throw, just log the error
      const result = await client.createAddress('test');

      expect(result).toBe('bc1q...');
    });

    it('should skip unlock when operation does not require it', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: 750000, error: null, id: 'test' });

      await client.getBlockCount();

      const calls = mockRpcPost.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).not.toContain('walletpassphrase');
    });
  });

  // --- Retry Logic Tests --- //

  describe('Retry Logic', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('should retry on SyntaxError up to 3 times', async () => {
      const syntaxError = new SyntaxError('Unexpected end of JSON input');

      mockRpcPost
        .mockRejectedValueOnce(syntaxError)
        .mockRejectedValueOnce(syntaxError)
        .mockResolvedValueOnce({ result: 750000, error: null, id: 'test' });

      const result = await client.getBlockCount();

      expect(result).toBe(750000);
      expect(mockRpcPost).toHaveBeenCalledTimes(3);
    });

    it('should throw after 3 SyntaxError retries', async () => {
      const syntaxError = new SyntaxError('Unexpected end of JSON input');

      mockRpcPost.mockRejectedValue(syntaxError);

      await expect(client.getBlockCount()).rejects.toThrow('Unexpected end of JSON input');
      expect(mockRpcPost).toHaveBeenCalledTimes(3);
    });

    it('should not retry on other errors', async () => {
      const otherError = new Error('Connection refused');

      mockRpcPost.mockRejectedValue(otherError);

      await expect(client.getBlockCount()).rejects.toThrow('Connection refused');
      expect(mockRpcPost).toHaveBeenCalledTimes(1);
    });
  });

  // --- sendUtxoToMany Tests --- //

  describe('sendUtxoToMany', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('should send to multiple addresses', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' }); // unlock
      mockRpcPost.mockResolvedValueOnce({ result: 'txid123', error: null, id: 'test' });

      const payload = [
        { addressTo: 'bc1qaddr1', amount: 0.1 },
        { addressTo: 'bc1qaddr2', amount: 0.2 },
      ];

      const result = await client.sendUtxoToMany(payload);

      expect(result).toBe('txid123');

      const calls = mockRpcPost.mock.calls;
      const sendmanyCall = calls.find((call) => call[1].includes('sendmany'));
      expect(sendmanyCall![1]).toContain('"bc1qaddr1":0.1');
      expect(sendmanyCall![1]).toContain('"bc1qaddr2":0.2');
    });

    it('should throw when more than 100 addresses', async () => {
      const payload = Array(101)
        .fill(null)
        .map((_, i) => ({ addressTo: `bc1qaddr${i}`, amount: 0.001 }));

      await expect(client.sendUtxoToMany(payload)).rejects.toThrow(
        'Too many addresses in one transaction batch, allowed max 100 for UTXO',
      );
    });
  });

  // --- CLI Command Tests --- //

  describe('sendCliCommand', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('should parse and execute CLI command', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: null, error: null, id: 'test' }); // unlock
      mockRpcPost.mockResolvedValueOnce({ result: { txid: 'abc' }, error: null, id: 'test' });

      await client.sendCliCommand('getrawtransaction "abc123" 2');

      const calls = mockRpcPost.mock.calls;
      const rpcCall = calls.find((call) => call[1].includes('getrawtransaction'));
      expect(rpcCall).toBeDefined();
    });

    it('should skip unlock when noAutoUnlock is true', async () => {
      mockRpcPost.mockResolvedValueOnce({ result: 750000, error: null, id: 'test' });

      await client.sendCliCommand('getblockcount', true);

      const calls = mockRpcPost.mock.calls;
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).not.toContain('walletpassphrase');
    });
  });

  // --- Utility Methods Tests --- //

  describe('Utility Methods', () => {
    let client: TestNodeClient;

    beforeEach(() => {
      client = new TestNodeClient(mockHttpService, 'http://localhost:8332');
    });

    it('roundAmount() should round to 8 decimal places', () => {
      expect(client.testRoundAmount(0.123456789)).toBe(0.12345679);
      expect(client.testRoundAmount(1.0)).toBe(1);
      expect(client.testRoundAmount(0.00000001)).toBe(0.00000001);
    });

    it('parseAmount() should split amount and asset', () => {
      const result = client.parseAmount('1.5@BTC');

      expect(result.amount).toBe(1.5);
      expect(result.asset).toBe('BTC');
    });

    it('clearRequestQueue() should clear the queue', () => {
      // Just verify it doesn't throw
      expect(() => client.clearRequestQueue()).not.toThrow();
    });
  });
});
