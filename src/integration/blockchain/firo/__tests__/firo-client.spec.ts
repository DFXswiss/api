/**
 * Unit tests for FiroClient's broadcast boundary.
 *
 * Firo has no atomic Bitcoin Core `send` RPC, so the client builds+signs locally
 * (createrawtransaction/signrawtransaction - pre-broadcast, plain Error) and only broadcasts via a
 * final sendrawtransaction call (mintspark is the exception: it builds+signs+broadcasts atomically
 * in one node-side call, like Bitcoin Core's `send`). At those boundaries only connection setup and
 * allowlisted pre-funding errors remain plain; ambiguous failures stay TxBroadcastError.
 */

import { HttpService } from 'src/shared/services/http.service';
import { TxBroadcastError } from '../../shared/errors/tx-broadcast.error';
import { FiroClient } from '../firo-client';

jest.mock('src/config/config', () => {
  const mockConfig = {
    blockchain: {
      firo: {
        user: 'testuser',
        password: 'testpass',
        walletPassword: 'walletpass123',
        walletAddress: 'tWalletAddress',
        allowUnconfirmedUtxos: true,
        transparentTxSize: 225,
        sparkMintTxSize: 480,
        inputSize: 225,
        outputSize: 34,
        txOverhead: 10,
      },
    },
    payment: {
      firoAddress: 'tPaymentAddress',
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

describe('FiroClient - broadcast boundary', () => {
  let client: FiroClient;
  let mockRpcPost: jest.Mock;
  let lastRpcCalls: Array<{ method: string; params: any[] }>;

  beforeEach(() => {
    lastRpcCalls = [];

    mockRpcPost = jest.fn().mockImplementation((_url, body) => {
      const parsed = JSON.parse(body);
      lastRpcCalls.push({ method: parsed.method, params: parsed.params });

      switch (parsed.method) {
        case 'walletpassphrase':
          return Promise.resolve({ result: null, error: null, id: 'test' });
        case 'listunspent':
          return Promise.resolve({
            result: [{ txid: 'utxo-1', vout: 0, address: 'tLiquidityAddr', amount: 5, confirmations: 6 }],
            error: null,
            id: 'test',
          });
        case 'createrawtransaction':
          return Promise.resolve({ result: 'rawtxhex', error: null, id: 'test' });
        case 'signrawtransaction':
          return Promise.resolve({ result: { hex: 'signedtxhex', complete: true }, error: null, id: 'test' });
        case 'sendrawtransaction':
          return Promise.resolve({ result: 'broadcasttxid123', error: null, id: 'test' });
        case 'mintspark':
          return Promise.resolve({ result: ['minttxid123'], error: null, id: 'test' });
        default:
          return Promise.resolve({ result: null, error: null, id: 'test' });
      }
    });

    const mockHttpService = {
      post: mockRpcPost,
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    client = new FiroClient(mockHttpService, 'http://localhost:8000');
  });

  function mockSendRawResponse(response: () => Promise<unknown>): void {
    mockRpcPost.mockImplementation((_url, body) => {
      const parsed = JSON.parse(body);
      if (parsed.method === 'sendrawtransaction') return response();
      if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
      if (parsed.method === 'listunspent')
        return Promise.resolve({
          result: [{ txid: 'utxo-1', vout: 0, address: 'tLiquidityAddr', amount: 5, confirmations: 6 }],
          error: null,
          id: 'test',
        });
      if (parsed.method === 'createrawtransaction')
        return Promise.resolve({ result: 'rawtxhex', error: null, id: 'test' });
      if (parsed.method === 'signrawtransaction')
        return Promise.resolve({ result: { hex: 'signedtxhex', complete: true }, error: null, id: 'test' });
      return Promise.resolve({ result: null, error: null, id: 'test' });
    });
  }

  describe('sendMany(...) -> buildSignAndBroadcast(...)', () => {
    it('returns the txid on a successful sendrawtransaction call', async () => {
      const result = await client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10);

      expect(result).toBe('broadcasttxid123');
    });

    it('wraps a failure of the final sendrawtransaction call into a TxBroadcastError', async () => {
      // BitcoinRpcClient.call() (shared by Bitcoin/Firo) wraps any transport-level rejection into
      // a plain Error prefixed with "Bitcoin RPC <method> failed: ..." before it reaches
      // buildSignAndBroadcast - that intermediate Error is observed and preserved as cause.
      mockRpcPost.mockImplementation((_url, body) => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'sendrawtransaction') return Promise.reject(new Error('tx-fee-not-met'));
        if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
        if (parsed.method === 'listunspent')
          return Promise.resolve({
            result: [{ txid: 'utxo-1', vout: 0, address: 'tLiquidityAddr', amount: 5, confirmations: 6 }],
            error: null,
            id: 'test',
          });
        if (parsed.method === 'createrawtransaction')
          return Promise.resolve({ result: 'rawtxhex', error: null, id: 'test' });
        if (parsed.method === 'signrawtransaction')
          return Promise.resolve({ result: { hex: 'signedtxhex', complete: true }, error: null, id: 'test' });
        return Promise.resolve({ result: null, error: null, id: 'test' });
      });

      let error: unknown;
      try {
        await client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Bitcoin RPC sendrawtransaction failed: tx-fee-not-met');
    });

    it('keeps an ECONNREFUSED sendrawtransaction failure plain', async () => {
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockSendRawResponse(() => Promise.reject(connectionError));

      await expect(client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10)).rejects.not.toBeInstanceOf(
        TxBroadcastError,
      );
    });

    it.each([
      [-6, 'RPC_WALLET_INSUFFICIENT_FUNDS'],
      [-13, 'RPC_WALLET_UNLOCK_NEEDED'],
    ])('keeps allowlisted RPC code %i (%s) plain', async (code) => {
      mockSendRawResponse(() =>
        Promise.resolve({ result: null, error: { code, message: 'deterministic wallet failure' }, id: 'test' }),
      );

      await expect(client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10)).rejects.not.toBeInstanceOf(
        TxBroadcastError,
      );
    });

    it('keeps a non-allowlisted RPC code fail-closed', async () => {
      mockSendRawResponse(() =>
        Promise.resolve({ result: null, error: { code: -25, message: 'missing inputs' }, id: 'test' }),
      );

      await expect(client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10)).rejects.toBeInstanceOf(
        TxBroadcastError,
      );
    });

    it.each(['ECONNRESET', 'ETIMEDOUT'])('keeps an ambiguous %s failure fail-closed', async (code) => {
      mockSendRawResponse(() => Promise.reject(Object.assign(new Error(code), { code })));

      await expect(client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10)).rejects.toBeInstanceOf(
        TxBroadcastError,
      );
    });

    it('does not wrap a pre-broadcast signing failure (plain Error propagates unchanged)', async () => {
      mockRpcPost.mockImplementation((_url, body) => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'signrawtransaction')
          return Promise.resolve({ result: { hex: '', complete: false }, error: null, id: 'test' });
        if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
        if (parsed.method === 'listunspent')
          return Promise.resolve({
            result: [{ txid: 'utxo-1', vout: 0, address: 'tLiquidityAddr', amount: 5, confirmations: 6 }],
            error: null,
            id: 'test',
          });
        if (parsed.method === 'createrawtransaction')
          return Promise.resolve({ result: 'rawtxhex', error: null, id: 'test' });
        return Promise.resolve({ result: null, error: null, id: 'test' });
      });

      let error: unknown;
      try {
        await client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toBe('Failed to sign Firo transaction');
    });

    it('does not wrap a pre-broadcast UTXO-fetch failure (plain Error propagates unchanged)', async () => {
      mockRpcPost.mockImplementation((_url, body) => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'listunspent') return Promise.reject(new Error('connection timeout'));
        if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
        return Promise.resolve({ result: null, error: null, id: 'test' });
      });

      let error: unknown;
      try {
        await client.sendMany([{ addressTo: 'tDestAddr', amount: 1 }], 10);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Bitcoin RPC listunspent failed: connection timeout');
    });
  });

  describe('mintSpark(...)', () => {
    it('returns the first txid on a successful mintspark call', async () => {
      const result = await client.mintSpark([{ address: 'sparkAddr1', amount: 1 }]);

      expect(result).toBe('minttxid123');
    });

    it('wraps a failure of the mintspark call into a TxBroadcastError', async () => {
      mockRpcPost.mockImplementation((_url, body) => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'mintspark') return Promise.reject(new Error('insufficient funds'));
        if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
        if (parsed.method === 'listunspent')
          return Promise.resolve({
            result: [{ txid: 'utxo-1', vout: 0, address: 'tLiquidityAddr', amount: 5, confirmations: 6 }],
            error: null,
            id: 'test',
          });
        return Promise.resolve({ result: null, error: null, id: 'test' });
      });

      let error: unknown;
      try {
        await client.mintSpark([{ address: 'sparkAddr1', amount: 1 }]);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Bitcoin RPC mintspark failed: insufficient funds');
    });

    it('keeps an RPC-successful-but-empty mintspark result fail-closed', async () => {
      mockRpcPost.mockImplementation((_url, body) => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'mintspark') return Promise.resolve({ result: [], error: null, id: 'test' });
        if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
        if (parsed.method === 'listunspent')
          return Promise.resolve({
            result: [{ txid: 'utxo-1', vout: 0, address: 'tLiquidityAddr', amount: 5, confirmations: 6 }],
            error: null,
            id: 'test',
          });
        return Promise.resolve({ result: null, error: null, id: 'test' });
      });

      let error: unknown;
      try {
        await client.mintSpark([{ address: 'sparkAddr1', amount: 1 }]);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toBe('mintspark returned no transaction IDs');
    });

    it('does not wrap a pre-broadcast no-UTXO failure (plain Error propagates unchanged)', async () => {
      mockRpcPost.mockImplementation((_url, body) => {
        const parsed = JSON.parse(body);
        if (parsed.method === 'listunspent') return Promise.resolve({ result: [], error: null, id: 'test' });
        if (parsed.method === 'walletpassphrase') return Promise.resolve({ result: null, error: null, id: 'test' });
        return Promise.resolve({ result: null, error: null, id: 'test' });
      });

      let error: unknown;
      try {
        await client.mintSpark([{ address: 'sparkAddr1', amount: 1 }]);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toBe('No non-deposit addresses with UTXOs available');
    });
  });
});
