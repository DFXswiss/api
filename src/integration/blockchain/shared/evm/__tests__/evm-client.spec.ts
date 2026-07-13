/**
 * Focused unit tests for the EvmClient broadcast boundary: the try/catch blocks around the actual
 * on-chain send calls in `sendNativeCoin` and `doSwap` (wallet.sendTransaction) and `sendToken`
 * (contract.transfer), which translate any failure at/after the broadcast call into a
 * TxBroadcastError while leaving explicit pre-broadcast gas estimation failures unchanged.
 *
 * EvmClient is a large abstract class whose constructor wires up real ethers.js collaborators
 * (StaticJsonRpcProvider, Wallet, AlphaRouter, ...) and pulls in the rest of its considerable
 * surface (Uniswap swaps, Alchemy history, ...). None of that is relevant here and constructing a
 * real instance would need live network config. To isolate JUST the changed methods, we call
 * the (protected/private) prototype methods directly via Function.prototype.call against a minimal
 * stub `this`: a plain object created with `Object.create(EvmClient.prototype)` (so it still has
 * EvmClient's prototype chain) with only the handful of collaborators the methods under test
 * depend on stubbed as own properties, which shadow the real prototype implementations. This
 * exercises the real, unmodified method bodies without needing a live provider/wallet/router.
 */

import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { EvmClient } from '../evm-client';

const proto = EvmClient.prototype as any;

interface ClientStub {
  provider: { estimateGas: jest.Mock };
  wallet: { address: string; sendTransaction: jest.Mock };
  swapContractAddress: string;
  getCurrentGasForCoinTransaction: jest.Mock;
  getTokenGasLimitForContact: jest.Mock;
  getRecommendedGasPrice: jest.Mock;
  getNonce: jest.Mock;
  setNonce: jest.Mock;
  getTokenByContract: jest.Mock;
}

function createClientStub(): ClientStub {
  const client = Object.create(EvmClient.prototype) as ClientStub;

  client.provider = { estimateGas: jest.fn().mockResolvedValue(120000) };
  client.wallet = { address: 'FROM_ADDR', sendTransaction: jest.fn() };
  client.swapContractAddress = 'SWAP_CONTRACT_ADDR';
  client.getCurrentGasForCoinTransaction = jest.fn().mockResolvedValue(21000);
  client.getTokenGasLimitForContact = jest.fn().mockResolvedValue(65000);
  client.getRecommendedGasPrice = jest.fn().mockResolvedValue(1_000_000_000);
  client.getNonce = jest.fn().mockResolvedValue(5);
  client.setNonce = jest.fn();
  client.getTokenByContract = jest.fn().mockResolvedValue({ decimals: 6 });

  return client;
}

describe('EvmClient - broadcast boundary', () => {
  describe('sendNativeCoin(...)', () => {
    it('broadcasts successfully, defaults to the current nonce and advances the cached nonce', async () => {
      const client = createClientStub();
      const sendTransaction = jest.fn().mockResolvedValue({ hash: 'TX_HASH_01' });
      const wallet = { address: 'FROM_ADDR', sendTransaction };

      const hash = await proto.sendNativeCoin.call(client, wallet, 'TO_ADDR', 1);

      expect(hash).toBe('TX_HASH_01');
      expect(sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'FROM_ADDR',
          to: 'TO_ADDR',
          nonce: 5,
          gasPrice: 1_000_000_000,
          gasLimit: 21000,
        }),
      );
      expect(client.setNonce).toHaveBeenCalledWith('FROM_ADDR', 6); // txNonce(5) >= currentNonce(5)
    });

    it('reuses an explicit lower nonce (speedup/retry) without advancing the cached nonce', async () => {
      const client = createClientStub();
      const sendTransaction = jest.fn().mockResolvedValue({ hash: 'TX_HASH_02' });
      const wallet = { address: 'FROM_ADDR', sendTransaction };

      const hash = await proto.sendNativeCoin.call(client, wallet, 'TO_ADDR', 1, 3);

      expect(hash).toBe('TX_HASH_02');
      expect(sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ nonce: 3 }));
      expect(client.setNonce).not.toHaveBeenCalled(); // txNonce(3) < currentNonce(5)
    });

    it('wraps an Error thrown by wallet.sendTransaction into a TxBroadcastError, preserving message and cause', async () => {
      const client = createClientStub();
      const rpcError = new Error('nonce too low');
      const wallet = { address: 'FROM_ADDR', sendTransaction: jest.fn().mockRejectedValue(rpcError) };

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('nonce too low');
      expect((error as TxBroadcastError).cause).toBe(rpcError);
      expect(client.setNonce).not.toHaveBeenCalled();
    });

    it('wraps a non-Error rejection from wallet.sendTransaction into a TxBroadcastError via String(e)', async () => {
      const client = createClientStub();
      const wallet = { address: 'FROM_ADDR', sendTransaction: jest.fn().mockRejectedValue('RPC timeout') };

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('RPC timeout');
      expect((error as TxBroadcastError).cause).toBe('RPC timeout');
      expect(client.setNonce).not.toHaveBeenCalled();
    });

    it('treats an empty tx hash as a broadcast-boundary failure (fail-closed: the send call was reached)', async () => {
      const client = createClientStub();
      const sendTransaction = jest.fn().mockResolvedValue({ hash: '' });
      const wallet = { address: 'FROM_ADDR', sendTransaction };

      let error: unknown;
      try {
        await proto.sendNativeCoin.call(client, wallet, 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Broadcast returned an empty tx hash');
      expect(client.setNonce).not.toHaveBeenCalled(); // never advance the nonce on an unconfirmed broadcast
    });
  });

  describe('sendToken(...)', () => {
    it('broadcasts successfully, defaults to the current nonce and advances the cached nonce', async () => {
      const client = createClientStub();
      const transfer = jest.fn().mockResolvedValue({ hash: 'TX_HASH_03' });
      const contract = { transfer };

      const hash = await proto.sendToken.call(client, contract, 'FROM_ADDR', 'TO_ADDR', 1);

      expect(hash).toBe('TX_HASH_03');
      expect(transfer).toHaveBeenCalledWith(
        'TO_ADDR',
        expect.anything(),
        expect.objectContaining({ nonce: 5, gasPrice: 1_000_000_000, gasLimit: 65000 }),
      );
      expect(client.setNonce).toHaveBeenCalledWith('FROM_ADDR', 6); // txNonce(5) >= currentNonce(5)
    });

    it('reuses an explicit lower nonce (speedup/retry) without advancing the cached nonce', async () => {
      const client = createClientStub();
      const transfer = jest.fn().mockResolvedValue({ hash: 'TX_HASH_04' });
      const contract = { transfer };

      const hash = await proto.sendToken.call(client, contract, 'FROM_ADDR', 'TO_ADDR', 1, 3);

      expect(hash).toBe('TX_HASH_04');
      expect(transfer).toHaveBeenCalledWith('TO_ADDR', expect.anything(), expect.objectContaining({ nonce: 3 }));
      expect(client.setNonce).not.toHaveBeenCalled(); // txNonce(3) < currentNonce(5)
    });

    it('wraps an Error thrown by contract.transfer into a TxBroadcastError, preserving message and cause', async () => {
      const client = createClientStub();
      const rpcError = new Error('replacement transaction underpriced');
      const contract = { transfer: jest.fn().mockRejectedValue(rpcError) };

      let error: unknown;
      try {
        await proto.sendToken.call(client, contract, 'FROM_ADDR', 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('replacement transaction underpriced');
      expect((error as TxBroadcastError).cause).toBe(rpcError);
      expect(client.setNonce).not.toHaveBeenCalled();
    });

    it('wraps a non-Error rejection from contract.transfer into a TxBroadcastError via String(e)', async () => {
      const client = createClientStub();
      const contract = { transfer: jest.fn().mockRejectedValue('RPC timeout') };

      let error: unknown;
      try {
        await proto.sendToken.call(client, contract, 'FROM_ADDR', 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('RPC timeout');
      expect((error as TxBroadcastError).cause).toBe('RPC timeout');
      expect(client.setNonce).not.toHaveBeenCalled();
    });

    it('treats an empty tx hash as a broadcast-boundary failure (fail-closed: the send call was reached)', async () => {
      const client = createClientStub();
      const transfer = jest.fn().mockResolvedValue({ hash: '' });
      const contract = { transfer };

      let error: unknown;
      try {
        await proto.sendToken.call(client, contract, 'FROM_ADDR', 'TO_ADDR', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Broadcast returned an empty tx hash');
      expect(client.setNonce).not.toHaveBeenCalled(); // never advance the nonce on an unconfirmed broadcast
    });
  });

  describe('doSwap(...)', () => {
    const parameters = { calldata: '0x1234', value: '100' };

    it('wraps a wallet.sendTransaction failure in a TxBroadcastError', async () => {
      const client = createClientStub();
      const rpcError = new Error('replacement transaction underpriced');
      client.wallet.sendTransaction.mockRejectedValue(rpcError);

      let error: unknown;
      try {
        await proto.doSwap.call(client, parameters);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('replacement transaction underpriced');
      expect((error as TxBroadcastError).cause).toBe(rpcError);
      expect(client.provider.estimateGas).toHaveBeenCalledWith({
        data: '0x1234',
        to: 'SWAP_CONTRACT_ADDR',
        value: '100',
        from: 'FROM_ADDR',
        gasPrice: 1_000_000_000,
        nonce: 5,
      });
      expect(client.wallet.sendTransaction).toHaveBeenCalledWith(expect.objectContaining({ gasLimit: 120000 }));
      expect(client.setNonce).not.toHaveBeenCalled();
    });

    it('wraps an empty transaction hash in a TxBroadcastError', async () => {
      const client = createClientStub();
      client.wallet.sendTransaction.mockResolvedValue({ hash: '' });

      let error: unknown;
      try {
        await proto.doSwap.call(client, parameters);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(TxBroadcastError);
      expect((error as TxBroadcastError).message).toBe('Broadcast returned an empty tx hash');
      expect(client.setNonce).not.toHaveBeenCalled();
    });

    it('leaves a pre-broadcast slippage estimation failure unchanged', async () => {
      const client = createClientStub();
      const slippageError = {
        reason: 'execution reverted: Too little received',
        error: { reason: 'processing response error' },
      };
      client.provider.estimateGas.mockRejectedValue(slippageError);

      let error: unknown;
      try {
        await proto.doSwap.call(client, parameters);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(slippageError);
      expect(error).not.toBeInstanceOf(TxBroadcastError);
      expect(client.wallet.sendTransaction).not.toHaveBeenCalled();
      expect(client.setNonce).not.toHaveBeenCalled();
    });
  });
});

describe('EvmClient - getTransactionCount block tag', () => {
  // Call the real method body with a stubbed provider so we can assert the block-tag
  // forwarding without constructing a live EvmClient (same isolation pattern as the
  // broadcast-boundary suite above).
  const proto = EvmClient.prototype as any;

  it('defaults to the latest (mined) nonce when no block tag is given', async () => {
    const getTransactionCount = jest.fn().mockResolvedValue(5);
    const client = Object.create(EvmClient.prototype);
    client.provider = { getTransactionCount };

    const result = await proto.getTransactionCount.call(client, '0xabc');

    expect(result).toBe(5);
    expect(getTransactionCount).toHaveBeenCalledWith('0xabc', 'latest');
  });

  it('forwards the pending block tag to count still-pending mempool txs', async () => {
    const getTransactionCount = jest.fn().mockResolvedValue(7);
    const client = Object.create(EvmClient.prototype);
    client.provider = { getTransactionCount };

    const result = await proto.getTransactionCount.call(client, '0xabc', 'pending');

    expect(result).toBe(7);
    expect(getTransactionCount).toHaveBeenCalledWith('0xabc', 'pending');
  });
});
