/**
 * Focused unit test for the CardanoClient broadcast boundary: the try/catch around the on-chain
 * submit call in `sendNativeCoin` (blockFrostApi.txSubmit), which translates any failure at/after
 * the broadcast call into a TxBroadcastError. Everything before that call (building/signing the
 * transaction via createSignedTransactionBlockFrost) is provably pre-broadcast and must keep
 * propagating as a plain error.
 *
 * CardanoClient's constructor wires up a real CardanoWallet from a mnemonic and other collaborators
 * that need live config. To isolate JUST the changed method, we call the private prototype method
 * directly via Function.prototype.call against a minimal stub `this`, following the same pattern as
 * evm-client.spec.ts.
 */

import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { CardanoClient } from '../cardano-client';

const proto = CardanoClient.prototype as any;

function createClientStub(txSubmit: jest.Mock): any {
  const client = Object.create(CardanoClient.prototype);

  client.createSignedTransactionBlockFrost = jest.fn().mockResolvedValue('SIGNED_TX_HEX');
  client.getBlockFrostAPI = jest.fn().mockReturnValue({ txSubmit });

  return client;
}

describe('CardanoClient - broadcast boundary', () => {
  describe('sendNativeCoin(...)', () => {
    it('returns the tx hash on a successful submit', async () => {
      const txSubmit = jest.fn().mockResolvedValue('TX_HASH_01');
      const client = createClientStub(txSubmit);

      const hash = await proto.sendNativeCoin.call(client, { address: 'FROM_ADDR' }, 'TO_ADDR', 1);

      expect(hash).toBe('TX_HASH_01');
      expect(txSubmit).toHaveBeenCalledWith('SIGNED_TX_HEX');
    });

    it('wraps an Error thrown by blockFrostApi.txSubmit into a TxBroadcastError, preserving message and cause', async () => {
      const submitError = new Error('UTXO already spent');
      const txSubmit = jest.fn().mockRejectedValue(submitError);
      const client = createClientStub(txSubmit);

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, { address: 'FROM_ADDR' }, 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('UTXO already spent');
      expect((error as TxBroadcastError).cause).toBe(submitError);
    });

    it('wraps a non-Error rejection from blockFrostApi.txSubmit into a TxBroadcastError via String(e)', async () => {
      const txSubmit = jest.fn().mockRejectedValue('BlockFrost timeout');
      const client = createClientStub(txSubmit);

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, { address: 'FROM_ADDR' }, 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('BlockFrost timeout');
      expect((error as TxBroadcastError).cause).toBe('BlockFrost timeout');
    });

    it('does not wrap a failure from building/signing the tx (pre-broadcast, plain error propagates unchanged)', async () => {
      const preBroadcastError = new Error('insufficient UTXOs');
      const client: any = Object.create(CardanoClient.prototype);
      client.createSignedTransactionBlockFrost = jest.fn().mockRejectedValue(preBroadcastError);
      client.getBlockFrostAPI = jest.fn();

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, { address: 'FROM_ADDR' }, 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(preBroadcastError); // same object - not wrapped
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(client.getBlockFrostAPI).not.toHaveBeenCalled();
    });
  });
});
