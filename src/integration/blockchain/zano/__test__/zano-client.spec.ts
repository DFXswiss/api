/**
 * Unit tests for ZanoClient's broadcast boundary.
 *
 * The wallet RPC's 'transfer' method builds, signs and relays a Zano transaction atomically.
 * Connection-establishment failures remain plain. Without verified numeric pre-funding constants,
 * every coded RPC error, timeout, reset and malformed response stays fail-closed.
 */

import { HttpService } from 'src/shared/services/http.service';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { TxBroadcastError } from '../../shared/errors/tx-broadcast.error';
import { ZanoClient } from '../zano-client';

const ZANO_COIN_ID = 'd6329b5b1f7c0805b5c345f4957554002a2f557845f64d7645dae0e051a6498a';

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

  // #4287 stage 3: the exact atomic-unit -> whole-unit decimal capture used by the deposit exact path.
  describe('getTransactionHistory(...) exact base-unit capture (#4287 stage 3)', () => {
    function txClient(receive: { amount: number; asset_id: string; index: number }[]): ZanoClient {
      const get = jest.fn().mockResolvedValue({ height: 11 }); // getNodeBlockHeight -> 10, so count > 0
      const post = jest.fn().mockResolvedValue({
        result: {
          transfers: [
            {
              height: 5,
              tx_hash: 'TX',
              tx_type: 0,
              fee: 10000000000,
              timestamp: 1,
              payment_id: '',
              employed_entries: { receive },
            },
          ],
        },
      });
      return new ZanoClient({ post, get } as unknown as jest.Mocked<HttpService>);
    }

    it('captures the exact whole-unit coin decimal from the raw atomic integer (12-dp precision)', async () => {
      const client = txClient([{ amount: 123456789012, asset_id: ZANO_COIN_ID, index: 0 }]);

      const [transfer] = await client.getTransactionHistory(0);

      expect(transfer.receive[0].amountExact).toBe('0.123456789012'); // exact, lost by the 8-dp float derivation
      expect(transfer.receive[0].amount).toBeCloseTo(0.123456789012, 12);
    });

    it('leaves amountExact undefined for an atomic value beyond the safe-integer range (fail-open)', async () => {
      const client = txClient([{ amount: Number.MAX_SAFE_INTEGER + 2, asset_id: ZANO_COIN_ID, index: 0 }]);

      const [transfer] = await client.getTransactionHistory(0);

      expect(transfer.receive[0].amountExact).toBeUndefined();
    });
  });

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

    it('keeps an ECONNREFUSED transfer failure plain because the request never reached the wallet', async () => {
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.reject(connectionError);
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(connectionError);
      expect(error).not.toBeInstanceOf(TxBroadcastError);
    });

    it('keeps an in-band RPC error fail-closed because Zano has no verified numeric allowlist', async () => {
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.resolve({ error: { code: -17, message: 'not enough money' } });
      });

      await expect(client.sendCoins(payout)).rejects.toBeInstanceOf(TxBroadcastError);
    });

    it.each(['ECONNRESET', 'ETIMEDOUT'])('keeps an ambiguous %s transfer failure fail-closed', async (code) => {
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.reject(Object.assign(new Error(code), { code }));
      });

      await expect(client.sendCoins(payout)).rejects.toBeInstanceOf(TxBroadcastError);
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

    it('wraps a transfer response with an empty tx_hash into a TxBroadcastError (fail-closed)', async () => {
      mockPost.mockImplementation((_url, params) => {
        if (params.method === 'getbalance')
          return Promise.resolve({ result: { balance: 100e12, unlocked_balance: 100e12, balances: [] } });
        return Promise.resolve({ result: { tx_details: { tx_hash: '' } } });
      });

      let error: unknown;
      try {
        await client.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Zano broadcast returned an empty tx hash');
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
