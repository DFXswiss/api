/**
 * Unit Tests for BitcoinRpcClient
 *
 * These tests verify the correct behavior of the custom Bitcoin RPC client
 * including parameter ordering, RPC structure, and error handling.
 */

import { HttpService } from 'src/shared/services/http.service';
import { BitcoinRpcClient } from '../bitcoin-rpc-client';
import { BitcoinRpcConfig } from '../bitcoin-rpc-types';

describe('BitcoinRpcClient', () => {
  let client: BitcoinRpcClient;
  let mockHttpService: jest.Mocked<HttpService>;
  let lastPostCall: { url: string; body: any; config: any } | null = null;

  const testConfig: BitcoinRpcConfig = {
    url: 'http://localhost:8332',
    username: 'testuser',
    password: 'testpass',
  };

  beforeEach(() => {
    lastPostCall = null;

    mockHttpService = {
      post: jest.fn().mockImplementation((url, body, config) => {
        lastPostCall = { url, body: JSON.parse(body), config };
        return Promise.resolve({ result: null, error: null, id: 'test' });
      }),
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    client = new BitcoinRpcClient(mockHttpService, testConfig);
  });

  // --- URL Construction Tests --- //

  describe('URL Construction', () => {
    it('should construct correct URL from config', () => {
      expect(client.getUrl()).toBe('http://localhost:8332');
    });

    it('should handle HTTPS URL', () => {
      const httpsConfig: BitcoinRpcConfig = { ...testConfig, url: 'https://localhost:443' };
      const httpsClient = new BitcoinRpcClient(mockHttpService, httpsConfig);
      expect(httpsClient.getUrl()).toBe('https://localhost:443');
    });
  });

  // --- RPC Call Structure Tests --- //

  describe('RPC Call Structure', () => {
    it('should use JSON-RPC 1.0 format', async () => {
      await client.getBlockCount();

      expect(lastPostCall?.body.jsonrpc).toBe('1.0');
    });

    it('should include unique request ID', async () => {
      await client.getBlockCount();

      expect(lastPostCall?.body.id).toMatch(/^btc-rpc-\d+$/);
    });

    it('should use positional parameters (array)', async () => {
      await client.getBlockHash(100);

      expect(Array.isArray(lastPostCall?.body.params)).toBe(true);
      expect(lastPostCall?.body.params).toEqual([100]);
    });

    it('should include correct Authorization header', async () => {
      await client.getBlockCount();

      const expectedAuth = 'Basic ' + Buffer.from('testuser:testpass').toString('base64');
      expect(lastPostCall?.config.headers.Authorization).toBe(expectedAuth);
    });

    it('should set Content-Type to application/json', async () => {
      await client.getBlockCount();

      expect(lastPostCall?.config.headers['Content-Type']).toBe('application/json');
    });
  });

  // --- Blockchain Methods Parameter Tests --- //

  describe('Blockchain Methods - Parameter Ordering', () => {
    it('getBlockchainInfo() should have no parameters', async () => {
      await client.getBlockchainInfo();

      expect(lastPostCall?.body.method).toBe('getblockchaininfo');
      expect(lastPostCall?.body.params).toEqual([]);
    });

    it('getBlockCount() should have no parameters', async () => {
      await client.getBlockCount();

      expect(lastPostCall?.body.method).toBe('getblockcount');
      expect(lastPostCall?.body.params).toEqual([]);
    });

    it('getBlockHash(height) should pass height as first parameter', async () => {
      await client.getBlockHash(500000);

      expect(lastPostCall?.body.method).toBe('getblockhash');
      expect(lastPostCall?.body.params).toEqual([500000]);
    });

    it('getBlock(hash, verbosity) should pass parameters in order', async () => {
      const hash = '00000000000000000001234567890abcdef';

      await client.getBlock(hash, 2);

      expect(lastPostCall?.body.method).toBe('getblock');
      expect(lastPostCall?.body.params).toEqual([hash, 2]);
    });

    it('getBlock(hash) should default verbosity to 1', async () => {
      const hash = '00000000000000000001234567890abcdef';

      await client.getBlock(hash);

      expect(lastPostCall?.body.params).toEqual([hash, 1]);
    });
  });

  // --- Transaction Methods Parameter Tests --- //

  describe('Transaction Methods - Parameter Ordering', () => {
    it('getTransaction(txid, includeWatchonly) should pass parameters in order', async () => {
      const txid = 'abc123def456';

      await client.getTransaction(txid, false);

      expect(lastPostCall?.body.method).toBe('gettransaction');
      expect(lastPostCall?.body.params).toEqual([txid, false]);
    });

    it('getTransaction(txid) should default includeWatchonly to true', async () => {
      const txid = 'abc123def456';

      await client.getTransaction(txid);

      expect(lastPostCall?.body.params).toEqual([txid, true]);
    });

    it('sendRawTransaction(hex) should pass hex as single parameter', async () => {
      const hex = '0100000001...';

      await client.sendRawTransaction(hex);

      expect(lastPostCall?.body.method).toBe('sendrawtransaction');
      expect(lastPostCall?.body.params).toEqual([hex]);
    });

    it('sendRawTransaction(hex, maxfeerate) should pass both parameters', async () => {
      const hex = '0100000001...';

      await client.sendRawTransaction(hex, 0.1);

      expect(lastPostCall?.body.params).toEqual([hex, 0.1]);
    });

    it('testMempoolAccept(rawtxs) should wrap in array', async () => {
      const rawtxs = ['hex1', 'hex2'];

      await client.testMempoolAccept(rawtxs);

      expect(lastPostCall?.body.method).toBe('testmempoolaccept');
      expect(lastPostCall?.body.params).toEqual([rawtxs]);
    });

    it('testMempoolAccept(rawtxs, maxfeerate) should pass both parameters', async () => {
      const rawtxs = ['hex1'];

      await client.testMempoolAccept(rawtxs, 0.5);

      expect(lastPostCall?.body.params).toEqual([rawtxs, 0.5]);
    });

    it('getMempoolEntry(txid) should pass txid as single parameter', async () => {
      const txid = 'abc123';

      await client.getMempoolEntry(txid);

      expect(lastPostCall?.body.method).toBe('getmempoolentry');
      expect(lastPostCall?.body.params).toEqual([txid]);
    });
  });

  // --- Wallet Methods Parameter Tests --- //

  describe('Wallet Methods - Parameter Ordering', () => {
    it('getNewAddress(label, type) should pass parameters in order', async () => {
      await client.getNewAddress('my-label', 'bech32');

      expect(lastPostCall?.body.method).toBe('getnewaddress');
      expect(lastPostCall?.body.params).toEqual(['my-label', 'bech32']);
    });

    it('getNewAddress() should use defaults', async () => {
      await client.getNewAddress();

      expect(lastPostCall?.body.params).toEqual(['', 'bech32']);
    });

    it('getNewAddress(label, p2sh-segwit) should pass p2sh-segwit correctly', async () => {
      await client.getNewAddress('test', 'p2sh-segwit');

      expect(lastPostCall?.body.params).toEqual(['test', 'p2sh-segwit']);
    });

    it('getNewAddress(label, legacy) should pass legacy correctly', async () => {
      await client.getNewAddress('test', 'legacy');

      expect(lastPostCall?.body.params).toEqual(['test', 'legacy']);
    });

    it('listUnspent(minconf, maxconf) should pass parameters in order', async () => {
      await client.listUnspent(1, 9999999);

      expect(lastPostCall?.body.method).toBe('listunspent');
      expect(lastPostCall?.body.params).toEqual([1, 9999999]);
    });

    it('listUnspent(minconf, maxconf, addresses) should include addresses', async () => {
      const addresses = ['addr1', 'addr2'];

      await client.listUnspent(0, 100, addresses);

      expect(lastPostCall?.body.params).toEqual([0, 100, addresses]);
    });

    it('listWallets() should have no parameters', async () => {
      await client.listWallets();

      expect(lastPostCall?.body.method).toBe('listwallets');
      expect(lastPostCall?.body.params).toEqual([]);
    });

    it('getWalletInfo() should have no parameters', async () => {
      await client.getWalletInfo();

      expect(lastPostCall?.body.method).toBe('getwalletinfo');
      expect(lastPostCall?.body.params).toEqual([]);
    });

    it('listTransactions(label, count, skip, includeWatchonly) should pass all parameters', async () => {
      await client.listTransactions('*', 50, 10, false);

      expect(lastPostCall?.body.method).toBe('listtransactions');
      expect(lastPostCall?.body.params).toEqual(['*', 50, 10, false]);
    });

    it('listAddressGroupings() should have no parameters', async () => {
      await client.listAddressGroupings();

      expect(lastPostCall?.body.method).toBe('listaddressgroupings');
      expect(lastPostCall?.body.params).toEqual([]);
    });

    it('walletPassphrase(passphrase, timeout) should pass parameters in order', async () => {
      await client.walletPassphrase('secret', 60);

      expect(lastPostCall?.body.method).toBe('walletpassphrase');
      expect(lastPostCall?.body.params).toEqual(['secret', 60]);
    });
  });

  // --- Send Methods Parameter Tests (CRITICAL) --- //

  describe('Send Methods - Parameter Ordering (CRITICAL)', () => {
    it('send(outputs) should pass outputs and null for optional params', async () => {
      const outputs = [{ bc1qtest: 0.001 }];

      await client.send(outputs);

      expect(lastPostCall?.body.method).toBe('send');
      expect(lastPostCall?.body.params).toEqual([outputs, null, null, null]);
    });

    it('send(outputs, confTarget, estimateMode, feeRate) should pass all parameters', async () => {
      const outputs = [{ bc1qtest: 0.001 }];

      await client.send(outputs, 6, 'economical', 10);

      expect(lastPostCall?.body.params).toEqual([outputs, 6, 'economical', 10]);
    });

    it('send(outputs, null, null, feeRate, options) should pass feeRate and options', async () => {
      const outputs = [{ bc1qtest: 0.001 }];
      const options = { replaceable: true, change_address: 'bc1qchange' };

      await client.send(outputs, null, null, 15, options);

      expect(lastPostCall?.body.params).toEqual([outputs, null, null, 15, options]);
    });

    it('send() with inputs option should include inputs in options', async () => {
      const outputs = [{ bc1qtest: 0.001 }];
      const options = {
        inputs: [{ txid: 'abc123', vout: 0 }],
        replaceable: true,
      };

      await client.send(outputs, null, null, 10, options);

      expect(lastPostCall?.body.params[4]).toEqual(options);
    });

    it('sendMany() should pass all 8 parameters in correct order', async () => {
      const amounts = { addr1: 0.001, addr2: 0.002 };

      await client.sendMany('', amounts, 1, 'test comment', ['addr1'], true, 6, 'economical');

      expect(lastPostCall?.body.method).toBe('sendmany');
      expect(lastPostCall?.body.params).toEqual(['', amounts, 1, 'test comment', ['addr1'], true, 6, 'economical']);
    });

    it('sendMany() with defaults should pass correct default values', async () => {
      const amounts = { addr1: 0.001 };

      await client.sendMany('', amounts);

      // Note: confTarget is passed as undefined which may become null in the array
      expect(lastPostCall?.body.params[0]).toBe('');
      expect(lastPostCall?.body.params[1]).toEqual(amounts);
      expect(lastPostCall?.body.params[2]).toBe(1);
      expect(lastPostCall?.body.params[3]).toBe('');
      expect(lastPostCall?.body.params[4]).toEqual([]);
      expect(lastPostCall?.body.params[5]).toBe(false);
      // confTarget can be undefined or null depending on serialization
      expect(lastPostCall?.body.params[7]).toBe('unset');
    });
  });

  // --- Fee Estimation Methods Parameter Tests --- //

  describe('Fee Estimation Methods - Parameter Ordering', () => {
    it('estimateSmartFee(confTarget, estimateMode) should pass parameters in order', async () => {
      await client.estimateSmartFee(6, 'conservative');

      expect(lastPostCall?.body.method).toBe('estimatesmartfee');
      expect(lastPostCall?.body.params).toEqual([6, 'conservative']);
    });

    it('estimateSmartFee(confTarget) should default to unset mode', async () => {
      await client.estimateSmartFee(1);

      expect(lastPostCall?.body.params).toEqual([1, 'unset']);
    });
  });

  // --- Error Handling Tests --- //

  describe('Error Handling', () => {
    it('should throw error with code when RPC returns error', async () => {
      mockHttpService.post.mockResolvedValueOnce({
        result: null,
        error: { code: -5, message: 'Invalid or non-wallet transaction id' },
        id: 'test',
      });

      await expect(client.getTransaction('nonexistent')).rejects.toMatchObject({
        message: 'Invalid or non-wallet transaction id',
        code: -5,
      });
    });

    it('should throw error with code -32600 for invalid request', async () => {
      mockHttpService.post.mockResolvedValueOnce({
        result: null,
        error: { code: -32600, message: 'Invalid Request' },
        id: 'test',
      });

      await expect(client.getBlockCount()).rejects.toMatchObject({
        code: -32600,
      });
    });

    it('should propagate HTTP errors', async () => {
      mockHttpService.post.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(client.getBlockCount()).rejects.toThrow('Connection refused');
    });

    it('should return result when no error', async () => {
      mockHttpService.post.mockResolvedValueOnce({
        result: 750000,
        error: null,
        id: 'test',
      });

      const result = await client.getBlockCount();

      expect(result).toBe(750000);
    });
  });

  // --- Raw Post Method Tests --- //

  describe('rawPost Method', () => {
    it('should send raw command with text/plain content type', async () => {
      const command = '{"jsonrpc":"1.0","method":"getblockcount","params":[]}';

      await client.rawPost(command);

      expect(mockHttpService.post).toHaveBeenCalledWith(
        'http://localhost:8332',
        command,
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'text/plain',
          }),
        }),
      );
    });
  });

  // --- Response Type Tests --- //

  describe('Response Types', () => {
    it('getBlockchainInfo should return BlockchainInfo structure', async () => {
      const mockInfo = {
        chain: 'main',
        blocks: 750000,
        headers: 750000,
        bestblockhash: '00000000000000000001...',
        difficulty: 35000000000000,
        mediantime: 1680000000,
        verificationprogress: 1,
        initialblockdownload: false,
        chainwork: '00000000000000000000000000000000...',
        size_on_disk: 500000000000,
        pruned: false,
        warnings: '',
      };

      mockHttpService.post.mockResolvedValueOnce({
        result: mockInfo,
        error: null,
        id: 'test',
      });

      const result = await client.getBlockchainInfo();

      expect(result).toEqual(mockInfo);
      expect(result.chain).toBe('main');
      expect(result.blocks).toBe(750000);
    });

    it('getWalletInfo should return WalletInfo structure', async () => {
      const mockWalletInfo = {
        walletname: 'default',
        walletversion: 169900,
        format: 'sqlite',
        balance: 1.5,
        unconfirmed_balance: 0.1,
        immature_balance: 0,
        txcount: 100,
        keypoololdest: 1600000000,
        keypoolsize: 1000,
        keypoolsize_hd_internal: 1000,
        paytxfee: 0,
        private_keys_enabled: true,
        avoid_reuse: false,
        scanning: false,
        descriptors: true,
      };

      mockHttpService.post.mockResolvedValueOnce({
        result: mockWalletInfo,
        error: null,
        id: 'test',
      });

      const result = await client.getWalletInfo();

      expect(result.balance).toBe(1.5);
      expect(typeof result.balance).toBe('number');
    });

    it('listUnspent should return UTXO array', async () => {
      const mockUtxos = [
        {
          txid: 'abc123',
          vout: 0,
          address: 'bc1q...',
          scriptPubKey: '0014...',
          amount: 0.5,
          confirmations: 6,
          spendable: true,
          solvable: true,
          safe: true,
        },
      ];

      mockHttpService.post.mockResolvedValueOnce({
        result: mockUtxos,
        error: null,
        id: 'test',
      });

      const result = await client.listUnspent();

      expect(Array.isArray(result)).toBe(true);
      expect(result[0].amount).toBe(0.5);
      expect(typeof result[0].amount).toBe('number');
    });
  });
});
