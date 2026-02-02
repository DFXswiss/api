/**
 * Unit Tests for BitcoinClient
 *
 * These tests verify the correct behavior of the BitcoinClient class,
 * including send methods, transaction handling, and balance queries.
 */

import { HttpService } from 'src/shared/services/http.service';
import { BitcoinClient } from '../bitcoin-client';

// Mock Config and GetConfig
jest.mock('src/config/config', () => {
  const mockConfig = {
    blockchain: {
      default: {
        user: 'testuser',
        password: 'testpass',
        walletPassword: 'walletpass123',
        allowUnconfirmedUtxos: true,
        btcOutput: {
          address: 'bc1qoutputaddress',
        },
      },
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

describe('BitcoinClient', () => {
  let client: BitcoinClient;
  let mockHttpService: jest.Mocked<HttpService>;
  let mockRpcPost: jest.Mock;
  let lastRpcCalls: Array<{ method: string; params: any[] }> = [];

  beforeEach(() => {
    lastRpcCalls = [];

    mockRpcPost = jest.fn().mockImplementation((url, body) => {
      const parsed = JSON.parse(body);
      lastRpcCalls.push({ method: parsed.method, params: parsed.params });

      // Default responses based on method
      if (parsed.method === 'walletpassphrase') {
        return Promise.resolve({ result: null, error: null, id: 'test' });
      }
      if (parsed.method === 'send') {
        return Promise.resolve({ result: { txid: 'newtxid123', complete: true }, error: null, id: 'test' });
      }
      if (parsed.method === 'sendrawtransaction') {
        return Promise.resolve({ result: 'broadcasttxid123', error: null, id: 'test' });
      }
      if (parsed.method === 'testmempoolaccept') {
        return Promise.resolve({
          result: [{ txid: 'testtxid', wtxid: 'testwtxid', allowed: true, vsize: 200, fees: { base: 0.00001 } }],
          error: null,
          id: 'test',
        });
      }
      if (parsed.method === 'listtransactions') {
        return Promise.resolve({
          result: [
            {
              address: 'bc1qaddr',
              category: 'receive',
              amount: 0.5,
              txid: 'txid1',
              confirmations: 6,
              blocktime: 1680000000,
              time: 1680000000,
              timereceived: 1680000000,
            },
          ],
          error: null,
          id: 'test',
        });
      }
      if (parsed.method === 'gettransaction') {
        return Promise.resolve({
          result: {
            txid: parsed.params[0],
            blockhash: '00000000...',
            confirmations: 6,
            time: 1680000000,
            amount: -0.5,
            fee: -0.0001,
          },
          error: null,
          id: 'test',
        });
      }
      if (parsed.method === 'listaddressgroupings') {
        return Promise.resolve({
          result: [
            [
              ['bc1qaddr1', 0.5, 'label1'],
              ['bc1qaddr2', 1.0, 'label2'],
            ],
            [['bc1qaddr3', 2.0]],
          ],
          error: null,
          id: 'test',
        });
      }
      if (parsed.method === 'getbalances') {
        return Promise.resolve({
          result: { mine: { trusted: 5.0, untrusted_pending: 0, immature: 0 } },
          error: null,
          id: 'test',
        });
      }
      if (parsed.method === 'getrawtransaction') {
        return Promise.resolve({
          result: {
            txid: parsed.params[0],
            blockhash: '00000000...',
            confirmations: 6,
            time: 1680000000,
            vin: [],
            vout: [],
          },
          error: null,
          id: 'test',
        });
      }

      return Promise.resolve({ result: null, error: null, id: 'test' });
    });

    mockHttpService = {
      post: mockRpcPost,
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    client = new BitcoinClient(mockHttpService, 'http://localhost:8332');
  });

  // --- Wallet Address Tests --- //

  describe('walletAddress', () => {
    it('should return configured output address', () => {
      expect(client.walletAddress).toBe('bc1qoutputaddress');
    });
  });

  // --- send() Method Tests (CRITICAL) --- //

  describe('send() Method (CRITICAL)', () => {
    it('should send with correct outputs structure', async () => {
      await client.send('bc1qrecipient', 'inputtxid', 0.5, 0, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      expect(sendCall).toBeDefined();

      // outputs should be array of {address: amount}
      const outputs = sendCall!.params[0];
      expect(Array.isArray(outputs)).toBe(true);
      expect(outputs[0]).toHaveProperty('bc1qrecipient');
    });

    it('should calculate fee correctly (135 vBytes estimate)', async () => {
      // Fee calculation: (feeRate * 135) / 10^8
      // With feeRate=10 sat/vB: (10 * 135) / 100000000 = 0.0000135 BTC
      const result = await client.send('bc1qrecipient', 'inputtxid', 0.5, 0, 10);

      expect(result.feeAmount).toBeCloseTo(0.0000135, 8);
    });

    it('should subtract fee from amount', async () => {
      await client.send('bc1qrecipient', 'inputtxid', 0.5, 0, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      const outputs = sendCall!.params[0];

      // Expected output: 0.5 - 0.0000135 = 0.4999865
      const outputAmount = outputs[0]['bc1qrecipient'];
      expect(outputAmount).toBeCloseTo(0.4999865, 7);
    });

    it('should include correct options with inputs and replaceable', async () => {
      await client.send('bc1qrecipient', 'inputtxid', 0.5, 2, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      const options = sendCall!.params[4];

      expect(options.inputs).toEqual([{ txid: 'inputtxid', vout: 2 }]);
      expect(options.replaceable).toBe(true);
    });

    it('should pass feeRate as 4th parameter', async () => {
      await client.send('bc1qrecipient', 'inputtxid', 0.5, 0, 15);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');

      // params: [outputs, confTarget(null), estimateMode(null), feeRate, options]
      expect(sendCall!.params[3]).toBe(15);
    });

    it('should return outTxId from result', async () => {
      const result = await client.send('bc1qrecipient', 'inputtxid', 0.5, 0, 10);

      expect(result.outTxId).toBe('newtxid123');
    });

    it('should handle empty result gracefully', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));

      const result = await client.send('bc1qrecipient', 'inputtxid', 0.5, 0, 10);

      expect(result.outTxId).toBe('');
    });
  });

  // --- sendMany() Method Tests (CRITICAL) --- //

  describe('sendMany() Method (CRITICAL)', () => {
    it('should send to multiple addresses with correct structure', async () => {
      const payload = [
        { addressTo: 'bc1qaddr1', amount: 0.1 },
        { addressTo: 'bc1qaddr2', amount: 0.2 },
      ];

      await client.sendMany(payload, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      expect(sendCall).toBeDefined();

      // outputs should be array of {address: amount} objects
      const outputs = sendCall!.params[0];
      expect(outputs).toHaveLength(2);
      expect(outputs[0]).toHaveProperty('bc1qaddr1', 0.1);
      expect(outputs[1]).toHaveProperty('bc1qaddr2', 0.2);
    });

    it('should include change_address in options', async () => {
      const payload = [{ addressTo: 'bc1qaddr1', amount: 0.1 }];

      await client.sendMany(payload, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      const options = sendCall!.params[4];

      expect(options.change_address).toBe('bc1qoutputaddress');
    });

    it('should set replaceable to true', async () => {
      const payload = [{ addressTo: 'bc1qaddr1', amount: 0.1 }];

      await client.sendMany(payload, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      const options = sendCall!.params[4];

      expect(options.replaceable).toBe(true);
    });

    it('should set include_unsafe to true to allow spending unconfirmed UTXOs', async () => {
      const payload = [{ addressTo: 'bc1qaddr1', amount: 0.1 }];

      await client.sendMany(payload, 10);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');
      const options = sendCall!.params[4];

      expect(options.include_unsafe).toBe(true);
    });

    it('should pass feeRate correctly', async () => {
      const payload = [{ addressTo: 'bc1qaddr1', amount: 0.1 }];

      await client.sendMany(payload, 25);

      const sendCall = lastRpcCalls.find((c) => c.method === 'send');

      expect(sendCall!.params[3]).toBe(25);
    });

    it('should return txid from result', async () => {
      const payload = [{ addressTo: 'bc1qaddr1', amount: 0.1 }];

      const result = await client.sendMany(payload, 10);

      expect(result).toBe('newtxid123');
    });
  });

  // --- testMempoolAccept() Tests --- //

  describe('testMempoolAccept()', () => {
    it('should wrap hex in array for RPC call', async () => {
      await client.testMempoolAccept('0100000001...');

      const call = lastRpcCalls.find((c) => c.method === 'testmempoolaccept');
      expect(call!.params[0]).toEqual(['0100000001...']);
    });

    it('should transform result correctly', async () => {
      const result = await client.testMempoolAccept('0100000001...');

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].txid).toBe('testtxid');
      expect(result[0].allowed).toBe(true);
      expect(result[0].vsize).toBe(200);
      expect(result[0].fees.base).toBe(0.00001);
    });

    it('should handle null/undefined fields in result', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: [{ txid: null, allowed: null, vsize: null, fees: null }],
          error: null,
          id: 'test',
        }),
      );

      const result = await client.testMempoolAccept('0100000001...');

      expect(result[0].txid).toBe('');
      expect(result[0].allowed).toBe(false);
      expect(result[0].vsize).toBe(0);
      expect(result[0].fees.base).toBe(0);
    });

    it('should return default result when RPC returns null', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));

      const result = await client.testMempoolAccept('0100000001...');

      expect(result[0].allowed).toBe(false);
      expect(result[0]['reject-reason']).toBe('RPC call failed');
    });

    it('should include reject-reason in result', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: [
            {
              txid: 'test',
              allowed: false,
              vsize: 0,
              fees: { base: 0 },
              'reject-reason': 'bad-txns-inputs-missingorspent',
            },
          ],
          error: null,
          id: 'test',
        }),
      );

      const result = await client.testMempoolAccept('0100000001...');

      expect(result[0]['reject-reason']).toBe('bad-txns-inputs-missingorspent');
    });
  });

  // --- sendSignedTransaction() Tests --- //

  describe('sendSignedTransaction()', () => {
    it('should call sendrawtransaction with hex', async () => {
      await client.sendSignedTransaction('0100000001...');

      const call = lastRpcCalls.find((c) => c.method === 'sendrawtransaction');
      expect(call!.params[0]).toBe('0100000001...');
    });

    it('should return hash on success', async () => {
      const result = await client.sendSignedTransaction('0100000001...');

      expect(result.hash).toBe('broadcasttxid123');
      expect(result.error).toBeUndefined();
    });

    it('should return error object on failure', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: null,
          error: { code: -25, message: 'bad-txns-inputs-missingorspent' },
          id: 'test',
        }),
      );

      const result = await client.sendSignedTransaction('0100000001...');

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(-25);
      expect(result.error!.message).toContain('bad-txns-inputs-missingorspent');
    });

    it('should handle exceptions with code property', async () => {
      const error = new Error('Connection failed') as Error & { code: number };
      error.code = -1;

      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() => Promise.reject(error));

      const result = await client.sendSignedTransaction('0100000001...');

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe(-1);
      expect(result.error!.message).toContain('Connection failed');
    });

    it('should handle exceptions without code property', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() => Promise.reject(new Error('Unknown error')));

      const result = await client.sendSignedTransaction('0100000001...');

      expect(result.error!.code).toBe(-1);
      expect(result.error!.message).toContain('Unknown error');
    });
  });

  // --- getRecentHistory() Tests --- //

  describe('getRecentHistory()', () => {
    it('should call listtransactions with correct parameters', async () => {
      await client.getRecentHistory(50);

      const call = lastRpcCalls.find((c) => c.method === 'listtransactions');
      expect(call!.params).toEqual(['*', 50, 0, true]);
    });

    it('should transform result correctly', async () => {
      const result = await client.getRecentHistory();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].address).toBe('bc1qaddr');
      expect(result[0].category).toBe('receive');
      expect(result[0].amount).toBe(0.5);
      expect(result[0].txid).toBe('txid1');
      expect(result[0].confirmations).toBe(6);
    });

    it('should default txCount to 100', async () => {
      await client.getRecentHistory();

      const call = lastRpcCalls.find((c) => c.method === 'listtransactions');
      expect(call!.params[1]).toBe(100);
    });

    it('should handle missing blocktime', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: [{ address: 'bc1q', category: 'receive', amount: 0.5, txid: 'tx1', confirmations: 0 }],
          error: null,
          id: 'test',
        }),
      );

      const result = await client.getRecentHistory();

      expect(result[0].blocktime).toBe(0);
    });
  });

  // --- isTxComplete() Tests (uses getRawTx/getrawtransaction) --- //

  describe('isTxComplete()', () => {
    it('should return true when TX has blockhash and confirmations > minConfirmations', async () => {
      // Default mock returns confirmations: 6, so this should pass with minConfirmations: 3
      const result = await client.isTxComplete('txid123', 3);

      expect(result).toBe(true);
    });

    it('should return false when TX has no blockhash (unconfirmed)', async () => {
      // getrawtransaction does not require wallet unlock
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: { txid: 'txid123', confirmations: 0, vin: [], vout: [] },
          error: null,
          id: 'test',
        }),
      );

      const result = await client.isTxComplete('txid123');

      expect(result).toBe(false);
    });

    it('should return false when TX not found', async () => {
      // getrawtransaction returns error -5 for non-existent TX
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: null,
          error: { code: -5, message: 'No such mempool or blockchain transaction' },
          id: 'test',
        }),
      );

      const result = await client.isTxComplete('nonexistent');

      expect(result).toBe(false);
    });

    it('should use 0 as default minConfirmations', async () => {
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: { txid: 'txid123', blockhash: '000...', confirmations: 1, vin: [], vout: [] },
          error: null,
          id: 'test',
        }),
      );

      const result = await client.isTxComplete('txid123');

      expect(result).toBe(true);
    });

    it('should return false when confirmations equals minConfirmations (boundary)', async () => {
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: { txid: 'txid123', blockhash: '000...', confirmations: 5, vin: [], vout: [] },
          error: null,
          id: 'test',
        }),
      );

      // confirmations (5) is NOT > minConfirmations (5), so should be false
      const result = await client.isTxComplete('txid123', 5);

      expect(result).toBe(false);
    });

    it('should handle undefined confirmations as 0', async () => {
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: { txid: 'txid123', blockhash: '000...', vin: [], vout: [] },
          error: null,
          id: 'test',
        }),
      );

      // undefined confirmations should be treated as 0, which is NOT > 0
      const result = await client.isTxComplete('txid123');

      expect(result).toBe(false);
    });
  });

  // --- getNativeCoinBalance() Tests --- //

  describe('getNativeCoinBalance()', () => {
    it('should return wallet balance (confirmed + unconfirmed)', async () => {
      // Mock returns trusted: 5.0, untrusted_pending: 0, immature: 0
      // getBalance() should return 5.0 + 0 = 5.0
      const result = await client.getNativeCoinBalance();

      expect(result).toBe(5.0);
    });

    it('should include unconfirmed balance', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() =>
        Promise.resolve({
          result: { mine: { trusted: 3.0, untrusted_pending: 1.5, immature: 0.5 } },
          error: null,
          id: 'test',
        }),
      );

      const result = await client.getNativeCoinBalance();

      // Should return 3.0 + 1.5 = 4.5 (excluding immature)
      expect(result).toBe(4.5);
    });
  });

  // --- getNativeCoinBalanceForAddress() Tests --- //

  describe('getNativeCoinBalanceForAddress()', () => {
    it('should return balance for known address', async () => {
      const result = await client.getNativeCoinBalanceForAddress('bc1qaddr2');

      expect(result).toBe(1.0);
    });

    it('should return 0 for unknown address', async () => {
      const result = await client.getNativeCoinBalanceForAddress('bc1qunknown');

      expect(result).toBe(0);
    });

    it('should search through all groupings', async () => {
      const result = await client.getNativeCoinBalanceForAddress('bc1qaddr3');

      expect(result).toBe(2.0);
    });

    it('should handle empty groupings', async () => {
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: null, error: null, id: 'test' }));
      mockRpcPost.mockImplementationOnce(() => Promise.resolve({ result: [], error: null, id: 'test' }));

      const result = await client.getNativeCoinBalanceForAddress('bc1qaddr1');

      expect(result).toBe(0);
    });
  });

  // --- Unimplemented Methods Tests --- //

  describe('Unimplemented Token Methods', () => {
    it('getToken() should throw "Bitcoin-based chain has no token"', async () => {
      await expect(client.getToken({} as any)).rejects.toThrow('Bitcoin-based chain has no token');
    });

    it('getTokenBalance() should throw "Bitcoin-based chain has no token"', async () => {
      await expect(client.getTokenBalance({} as any)).rejects.toThrow('Bitcoin-based chain has no token');
    });

    it('getTokenBalances() should throw "Bitcoin-based chain has no token"', async () => {
      await expect(client.getTokenBalances([])).rejects.toThrow('Bitcoin-based chain has no token');
    });
  });
});
