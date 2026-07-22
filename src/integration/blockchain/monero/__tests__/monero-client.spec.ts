/**
 * Unit tests for MoneroClient's broadcast boundary.
 *
 * The wallet RPC's 'transfer' method builds, signs and relays a Monero transaction atomically.
 * Connection-establishment failures and the two official pre-funding wallet codes remain plain;
 * timeouts, resets, malformed responses and every other RPC code stay fail-closed.
 */

import { HttpService } from 'src/shared/services/http.service';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { TxBroadcastError } from '../../shared/errors/tx-broadcast.error';
import { MoneroTransactionType } from '../dto/monero.dto';
import { MoneroClient } from '../monero-client';

jest.mock('src/config/config', () => {
  const mockConfig = {
    blockchain: {
      monero: {
        node: { url: 'https://monero-node.test' },
        rpc: { url: 'https://monero-rpc.test' },
        walletAddress: 'MONERO_WALLET_ADDR',
        certificate: undefined,
      },
    },
  };
  return {
    Config: mockConfig,
    GetConfig: () => mockConfig,
  };
});

describe('MoneroClient - broadcast boundary', () => {
  let client: MoneroClient;
  let mockPost: jest.Mock;

  beforeEach(() => {
    mockPost = jest.fn();

    const mockHttpService = {
      post: mockPost,
      get: jest.fn(),
    } as unknown as jest.Mocked<HttpService>;

    client = new MoneroClient(mockHttpService);
  });

  const payout: PayoutGroup = [{ addressTo: 'MONERO_DEST_ADDR', amount: 1.5 }];

  describe('sendTransfers(...)', () => {
    it('returns the mapped transfer on a successful RPC response', async () => {
      mockPost.mockResolvedValueOnce({
        result: { amount: 1500000000000, fee: 10000000000, tx_hash: 'TX_HASH_01' },
      });

      const result = await client.sendTransfers(payout);

      expect(result.txid).toBe('TX_HASH_01');
    });

    it('wraps a failure of the underlying HTTP call into a TxBroadcastError', async () => {
      const httpError = new Error('socket hang up');
      mockPost.mockRejectedValueOnce(httpError);

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('socket hang up');
      expect((error as TxBroadcastError).cause).toBe(httpError);
    });

    it('keeps an ECONNREFUSED HTTP failure plain because the request never reached the wallet', async () => {
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockPost.mockRejectedValueOnce(connectionError);

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(connectionError);
      expect(error).not.toBeInstanceOf(TxBroadcastError);
    });

    it.each([
      [-17, 'WALLET_RPC_ERROR_CODE_NOT_ENOUGH_MONEY'],
      [-37, 'WALLET_RPC_ERROR_CODE_NOT_ENOUGH_UNLOCKED_MONEY'],
    ])('keeps allowlisted RPC code %i (%s) plain', async (code) => {
      mockPost.mockResolvedValueOnce({ error: { code, message: 'deterministic pre-funding failure' } });

      await expect(client.sendTransfers(payout)).rejects.not.toBeInstanceOf(TxBroadcastError);
    });

    it('wraps a non-Error rejection into a TxBroadcastError via String(e)', async () => {
      mockPost.mockRejectedValueOnce('gateway timeout');

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('gateway timeout');
    });

    it('wraps an RPC-level error field (HTTP 200, JSON-RPC error) into a TxBroadcastError', async () => {
      mockPost.mockResolvedValueOnce({ error: { code: -18, message: 'Failed to send tx' } });

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Failed to send tx');
    });

    it.each(['ECONNRESET', 'ETIMEDOUT'])('keeps an ambiguous %s HTTP failure fail-closed', async (code) => {
      mockPost.mockRejectedValueOnce(Object.assign(new Error(code), { code }));

      await expect(client.sendTransfers(payout)).rejects.toBeInstanceOf(TxBroadcastError);
    });

    it('wraps a response with neither result nor error into a TxBroadcastError', async () => {
      mockPost.mockResolvedValueOnce({});

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('No result after send transfer');
    });

    it('wraps a malformed null body (throwing while reading result.error) into a TxBroadcastError, staying fail-closed', async () => {
      // A null/undefined body would make mapSendTransfer throw a plain TypeError; since it now runs
      // inside the boundary, that becomes a TxBroadcastError instead of a self-healing plain error.
      mockPost.mockResolvedValueOnce(null);

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
    });

    it('wraps a result with an empty tx_hash into a TxBroadcastError (fail-closed: transfer may already have been relayed)', async () => {
      mockPost.mockResolvedValueOnce({
        result: { amount: 1500000000000, fee: 10000000000, tx_hash: '' },
      });

      let error: unknown;
      try {
        await client.sendTransfers(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Monero broadcast returned an empty tx hash');
    });
  });

  // #4287 stage 3: the exact atomic-unit -> whole-unit XMR decimal capture used by the deposit exact path.
  describe('getTransfers(...) exact base-unit capture (#4287 stage 3)', () => {
    it('captures the exact whole-unit XMR decimal from the raw atomic integer (12-dp precision)', async () => {
      mockPost.mockResolvedValueOnce({
        result: { in: [{ amount: 123456789012, fee: 10000000000, txid: 'T', height: 5, timestamp: 1 }] },
      });

      const [transfer] = await client.getTransfers(MoneroTransactionType.in, 0);

      expect(transfer.amountExact).toBe('0.123456789012'); // exact, lost by the 8-dp float derivation
      expect(transfer.amount).toBeCloseTo(0.123456789012, 12); // the float stays as before
    });

    it('leaves amountExact undefined for an atomic value beyond the safe-integer range (fail-open)', async () => {
      mockPost.mockResolvedValueOnce({
        result: { in: [{ amount: Number.MAX_SAFE_INTEGER + 2, fee: 0, txid: 'T', height: 5, timestamp: 1 }] },
      });

      const [transfer] = await client.getTransfers(MoneroTransactionType.in, 0);

      expect(transfer.amountExact).toBeUndefined();
    });
  });
});
