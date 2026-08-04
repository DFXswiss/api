/**
 * Unit tests for MoneroClient's broadcast boundary.
 *
 * The wallet RPC's 'transfer' method builds, signs and relays a Monero transaction atomically.
 * Connection-establishment failures and the two official pre-funding wallet codes remain plain;
 * timeouts, resets, malformed responses and every other RPC code stay fail-closed. That path is still
 * used by callers with no order to persist a pre-relay txid against (dex withdrawal, pay-in forwarding).
 *
 * The payout path instead splits it into buildTransfer (do_not_relay, provably pre-broadcast, plain
 * errors) and relayTransfer (the sole in-flight step, fail-closed) — see #4673 and the split's
 * end-to-end behaviour in payout-monero-relay-split.spec.ts.
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

    // Left unset, ring_size arrives as 0, the wallet turns that into mixin 0 and adjust_mixin silently
    // raises it — "Requested ring size 1 too low, using 16" on every production transfer (#4673).
    it('pins the ring size explicitly instead of relying on the wallet correcting it', async () => {
      mockPost.mockResolvedValueOnce({
        result: { amount: 1500000000000, fee: 10000000000, tx_hash: 'TX_HASH_01' },
      });

      await client.sendTransfers(payout);

      expect(mockPost.mock.calls[0][1].params).toMatchObject({ ring_size: 16 });
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

    it('keeps a (code -4, message "failed to get output distribution") pair plain (pre-signing daemon fault)', async () => {
      // Real prod failure (order 112451, 2026-07-18 06:03:07): wallet_rpc_server::handle_rpc_exception
      // has no dedicated catch for error::get_output_distribution, so it falls through to the transfer
      // default (GENERIC_TRANSFER_ERROR = -4) while carrying the fixed what() message from the
      // struct's constructor (src/wallet/wallet_errors.h). The exception is constructed in
      // wallet2::get_outs during decoy selection — called from transfer_selected{,_rct} before inputs
      // are prepared and before anything is signed — so it is safe to roll back for auto-retry.
      mockPost.mockResolvedValue({
        error: { code: -4, message: 'failed to get output distribution' },
      });

      // Assert the message too: `not.toBeInstanceOf` alone would also pass for an unrelated TypeError
      // from a refactor, which would look like a successful classification while being a bug.
      await expect(client.sendTransfers(payout)).rejects.not.toBeInstanceOf(TxBroadcastError);
      await expect(client.sendTransfers(payout)).rejects.toThrow('failed to get output distribution');
    });

    it('keeps an unrelated code -4 message fail-closed (only the exact daemon-fault message is allowlisted)', async () => {
      mockPost.mockResolvedValueOnce({
        error: { code: -4, message: 'Failed to send tx' },
      });

      await expect(client.sendTransfers(payout)).rejects.toBeInstanceOf(TxBroadcastError);
    });

    it('keeps a bare code -38 fail-closed (the relay path emits -38 too)', async () => {
      // Regression guard. -38 WALLET_RPC_ERROR_CODE_NO_DAEMON_CONNECTION is tempting — it is the most
      // frequent flavour in production and its message reads pre-broadcast — but wallet2::commit_tx runs
      // THROW_ON_RPC_RESPONSE_ERROR right after /sendrawtransaction, and that helper raises
      // no_connection_to_daemon whenever the HTTP call returns false or the status is empty: precisely
      // the case where the daemon accepted the tx and only the response was lost. Since commit_tx writes
      // add_unconfirmed_tx / set_spent only AFTER that call, a retry would re-spend the same key images.
      // Only the (code, message) pair for the pre-signing decoy-selection path stays plain.
      mockPost.mockResolvedValueOnce({
        error: { code: -38, message: 'no connection to daemon' },
      });

      await expect(client.sendTransfers(payout)).rejects.toBeInstanceOf(TxBroadcastError);
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

  // #4673: the two halves of the split the payout path uses instead of the atomic call above.
  describe('buildTransfer(...)', () => {
    const buildResponse = {
      result: { amount: 1500000000000, fee: 10000000000, tx_hash: 'TX_HASH_01', tx_metadata: 'META_01' },
    };

    it('returns the signed transaction and its relay metadata', async () => {
      mockPost.mockResolvedValueOnce(buildResponse);

      await expect(client.buildTransfer(payout)).resolves.toEqual({ txId: 'TX_HASH_01', metadata: 'META_01' });
    });

    // The safety of the whole split rests on these three flags: do_not_relay makes fill_response skip
    // commit_tx (no /sendrawtransaction, no add_unconfirmed_tx, no set_spent), get_tx_metadata is what
    // makes the transaction relayable later without rebuilding it, and ring_size stops the wallet from
    // silently choosing for us. Pinned as a request contract, not as an implementation detail.
    it('requests a build-only transfer with relay metadata and a pinned ring size', async () => {
      mockPost.mockResolvedValueOnce(buildResponse);

      await client.buildTransfer(payout);

      const [, body] = mockPost.mock.calls[0];
      expect(body.method).toBe('transfer');
      expect(body.params).toMatchObject({ do_not_relay: true, get_tx_metadata: true, ring_size: 16 });
    });

    // Regression guard, and the point of #4673: with do_not_relay the wallet cannot have relayed
    // anything, so -38 here is provably pre-broadcast and must stay plain. Turning it into a
    // TxBroadcastError would restore the escalation the split exists to remove.
    it('keeps a build-phase -38 plain — do_not_relay means nothing was ever submitted', async () => {
      mockPost.mockResolvedValue({ error: { code: -38, message: 'no connection to daemon' } });

      await expect(client.buildTransfer(payout)).rejects.not.toBeInstanceOf(TxBroadcastError);
      await expect(client.buildTransfer(payout)).rejects.toThrow('no connection to daemon');
    });

    it.each([
      ['an ambiguous transport failure', Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' })],
      ['a timeout', Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' })],
    ])('keeps %s plain as well — the build phase has no in-flight state to protect', async (_, httpError) => {
      mockPost.mockRejectedValueOnce(httpError);

      await expect(client.buildTransfer(payout)).rejects.not.toBeInstanceOf(TxBroadcastError);
    });

    // A transaction that cannot be relayed would have to be rebuilt, which is the one thing the split
    // rules out — so an id without metadata is refused here rather than persisted as a dead end.
    it.each([
      ['an empty tx hash', { tx_hash: '', tx_metadata: 'META_01' }, 'empty tx hash'],
      ['no metadata', { tx_hash: 'TX_HASH_01' }, 'no tx metadata'],
    ])('rejects a build result with %s', async (_, result, message) => {
      mockPost.mockResolvedValueOnce({ result: { amount: 1, fee: 1, ...result } });

      await expect(client.buildTransfer(payout)).rejects.toThrow(message);
    });

    it.each([
      ['no result and no error', {}, 'No result after building the Monero transfer'],
      ['a null body', null, 'No response after building the Monero transfer'],
    ])('rejects a response with %s', async (_, response, message) => {
      mockPost.mockResolvedValueOnce(response);

      await expect(client.buildTransfer(payout)).rejects.toThrow(message);
    });
  });

  describe('relayTransfer(...)', () => {
    it('relays the stored metadata and returns the tx hash', async () => {
      mockPost.mockResolvedValueOnce({ result: { tx_hash: 'TX_HASH_01' } });

      await expect(client.relayTransfer('META_01')).resolves.toBe('TX_HASH_01');

      const [, body] = mockPost.mock.calls[0];
      expect(body).toMatchObject({ method: 'relay_tx', params: { hex: 'META_01' } });
    });

    // The relay is the only step that can leave a transaction in flight, so it keeps #4238's
    // fail-closed classification with no RPC-code allowlist at all — the pre-funding codes cannot
    // occur once the transaction is signed, and -4 decoy-selection faults belong to the build phase.
    it.each([
      [-38, 'no connection to daemon'],
      [-17, 'not enough money'],
      [-4, 'failed to get output distribution'],
    ])('keeps RPC code %i fail-closed, carrying the wallet error as cause', async (code, message) => {
      const rpcError = { code, message };
      mockPost.mockResolvedValueOnce({ error: rpcError });

      let error: unknown;
      try {
        await client.relayTransfer('META_01');
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe(message);
      // The wallet error is attached directly, not re-wrapped: an investigation needs the code, and
      // classifying it a second time is what an allowlist creeping back in would look like.
      expect((error as TxBroadcastError).cause).toBe(rpcError);
    });

    it('keeps an ECONNREFUSED failure plain because the request never reached the wallet', async () => {
      const connectionError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
      mockPost.mockRejectedValueOnce(connectionError);

      await expect(client.relayTransfer('META_01')).rejects.toBe(connectionError);
    });

    it.each([
      ['no result', {}, 'No result after relaying the Monero transfer'],
      ['an empty tx hash', { result: { tx_hash: '' } }, 'Monero relay returned an empty tx hash'],
    ])('fails closed on a response with %s', async (_, response, message) => {
      mockPost.mockResolvedValueOnce(response);

      await expect(client.relayTransfer('META_01')).rejects.toThrow(message);
      await expect(client.relayTransfer('META_01')).rejects.toBeInstanceOf(TxBroadcastError);
    });
  });

  describe('isTxKnown(...)', () => {
    it('reports a transaction the daemon knows — including one that is only in the pool', async () => {
      mockPost.mockResolvedValueOnce({ status: 'OK', txs: [{ tx_hash: 'TX_HASH_01', as_json: '{}' }] });

      await expect(client.isTxKnown('TX_HASH_01')).resolves.toBe(true);
    });

    // An unknown hash comes back as status OK with the hash under missed_tx, so `txs` is absent or
    // empty. Both mean "not relayed"; reading txs[0] out of an empty array used to throw instead.
    it.each([
      ['an absent txs list', { status: 'OK' }],
      ['an empty txs list', { status: 'OK', txs: [] }],
    ])('reports a transaction the daemon does not have (%s)', async (_, response) => {
      mockPost.mockResolvedValueOnce(response);

      await expect(client.isTxKnown('TX_HASH_01')).resolves.toBe(false);
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
