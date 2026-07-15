/**
 * Unit tests for MoneroClient's broadcast boundary.
 *
 * The wallet RPC's 'transfer' method builds, signs and relays a Monero transaction atomically in
 * one call - there is no separate pre-broadcast step to exclude. A failure of the HTTP call
 * itself, an RPC-level error field, or a missing result are all ambiguous (the wallet may have
 * already relayed before the response was lost/rejected) and must surface as TxBroadcastError,
 * mirroring the Solana sendTransaction boundary (result.error / empty hash -> TxBroadcastError).
 */

import { HttpService } from 'src/shared/services/http.service';
import { PayoutGroup } from 'src/subdomains/supporting/payout/services/base/payout-bitcoin-based.service';
import { TxBroadcastError } from '../../shared/errors/tx-broadcast.error';
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
  });
});
