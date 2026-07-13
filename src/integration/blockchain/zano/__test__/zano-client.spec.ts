/**
 * Unit tests for ZanoClient's broadcast boundary.
 *
 * The wallet RPC's 'transfer' method builds, signs and relays a Zano transaction atomically in
 * one call - there is no separate pre-broadcast step to exclude (the pre-broadcast balance checks
 * in sendCoins/sendTokens are separate 'getbalance' RPC calls). A failure of the HTTP call itself
 * or a response missing tx_details are both ambiguous (the wallet may have already relayed before
 * the response was lost/rejected) and must surface as TxBroadcastError, mirroring the Solana
 * sendTransaction boundary (result.error / empty hash -> TxBroadcastError).
 */

import { HttpService } from 'src/shared/services/http.service';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { TxBroadcastError } from '../../shared/errors/tx-broadcast.error';
import { ZanoClient } from '../zano-client';

jest.mock('src/config/config', () => {
  const mockConfig = {
    blockchain: {
      zano: {
        node: { url: 'https://zano-node.test' },
        wallet: { url: 'https://zano-wallet.test', address: 'ZANO_WALLET_ADDR' },
        coinId: 'd6329b5b1f7c0805b5c345f4957554002a2f557845f64d7645dae0e051a6498a',
        fee: 0.01,
      },
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

describe('ZanoClient - broadcast boundary', () => {
  let client: ZanoClient;
  let mockPost: jest.Mock;

  beforeEach(() => {
    mockPost = jest.fn().mockImplementation((_url, params) => {
      if (params.method === 'getbalance') {
        // 100 ZANO unlocked, comfortably above payout amount + fee
        return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
      }
      return Promise.resolve({ result: { tx_details: { tx_hash: 'TX_HASH_01' } } });
    });

    const mockHttpService = {
      post: mockPost,
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    client = new ZanoClient(mockHttpService);
  });

  const payout: PayoutGroup = [{ addressTo: 'ZANO_DEST_ADDR', amount: 1.5 }];

  describe('sendCoins(...)', () => {
    it('returns the tx id on a successful transfer', async () => {
      const result = await client.sendCoins(payout);

      expect(result.txId).toBe('TX_HASH_01');
    });

    it('wraps a failure of the underlying HTTP transfer call into a TxBroadcastError', async () => {
      const httpError = new Error('socket hang up');
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.reject(httpError);
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('socket hang up');
      expect((error as TxBroadcastError).cause).toBe(httpError);
    });

    it('wraps a non-Error rejection of the transfer call into a TxBroadcastError via String(e)', async () => {
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.reject('gateway timeout');
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('gateway timeout');
    });

    it('wraps a transfer response missing tx_details into a TxBroadcastError', async () => {
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.resolve({ result: {} });
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toContain('Transfer not sent');
    });

    it('wraps a malformed null transfer body (throwing while reading response.result) into a TxBroadcastError, staying fail-closed', async () => {
      // A null/undefined body would make createSendTransferResult throw a plain TypeError; since it
      // now runs inside the boundary, that becomes a TxBroadcastError instead of a self-healing error.
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.resolve(null);
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
    });

    it('does not wrap a pre-broadcast insufficient-balance failure (plain Error propagates unchanged)', async () => {
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 0, unlocked_balance: 0, balances: [] } });
        return Promise.resolve({ result: { tx_details: { tx_hash: 'TX_HASH_01' } } });
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect((error as Error).message).toContain('Unlocked coin balance');
    });
  });
});
