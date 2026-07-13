/**
 * Focused unit test for the SolanaClient broadcast boundary: `sendTransaction` signs and serializes
 * the transaction locally (pre-broadcast, provably safe to treat as a plain error), then calls
 * `sendSignedTransaction` to relay it over RPC with skipPreflight - once that call has been made, a
 * returned error is ambiguous (the node may already have accepted/relayed the tx), so it is
 * translated into a TxBroadcastError.
 *
 * SolanaClient's constructor wires up a real Connection/SolanaWallet that need live config. To
 * isolate JUST the changed method, we call the private prototype method directly via
 * Function.prototype.call against a minimal stub `this`, following the same pattern as
 * evm-client.spec.ts.
 */

import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { SolanaClient } from '../solana-client';

const proto = SolanaClient.prototype as any;

function createClientStub(sendSignedTransaction: jest.Mock): any {
  const client = Object.create(SolanaClient.prototype);

  client.sendSignedTransaction = sendSignedTransaction;

  return client;
}

function createTransactionStub(): any {
  return { serialize: jest.fn().mockReturnValue(Buffer.from('DEADBEEF', 'hex')) };
}

describe('SolanaClient - broadcast boundary', () => {
  describe('sendTransaction(...)', () => {
    it('signs, serializes and returns the tx hash when the RPC call succeeds', async () => {
      const sendSignedTransaction = jest.fn().mockResolvedValue({ hash: 'TX_HASH_01' });
      const client = createClientStub(sendSignedTransaction);
      const wallet = { signTransaction: jest.fn() };
      const transaction = createTransactionStub();

      const hash = await proto.sendTransaction.call(client, wallet, transaction);

      expect(hash).toBe('TX_HASH_01');
      expect(wallet.signTransaction).toHaveBeenCalledWith(transaction);
      expect(sendSignedTransaction).toHaveBeenCalledWith('deadbeef');
    });

    it('wraps an RPC error returned by sendSignedTransaction into a TxBroadcastError (fail-closed: request already sent)', async () => {
      const rpcError = { code: -32002, message: 'Transaction simulation failed' };
      const sendSignedTransaction = jest.fn().mockResolvedValue({ error: rpcError });
      const client = createClientStub(sendSignedTransaction);
      const wallet = { signTransaction: jest.fn() };
      const transaction = createTransactionStub();

      let error: unknown;
      try {
        await proto.sendTransaction.call(client, wallet, transaction);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Transaction simulation failed');
      expect((error as TxBroadcastError).cause).toBe(rpcError);
    });

    it('does not wrap a failure from wallet.signTransaction (local, pre-broadcast, plain error propagates unchanged)', async () => {
      const signError = new Error('invalid keypair');
      const sendSignedTransaction = jest.fn();
      const client = createClientStub(sendSignedTransaction);
      const wallet = {
        signTransaction: jest.fn().mockImplementation(() => {
          throw signError;
        }),
      };
      const transaction = createTransactionStub();

      let error: unknown;
      try {
        await proto.sendTransaction.call(client, wallet, transaction);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(signError); // same object - not wrapped
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(sendSignedTransaction).not.toHaveBeenCalled();
    });
  });
});
