/**
 * Unit tests for the broadcast-boundary mapping in PayoutEvmService: sendNativeCoin/sendToken
 * catch a TxBroadcastError from the (shared, non-payout-specific) EvmClient and re-throw it as a
 * PayoutBroadcastException, so the payout strategy can tell "the on-chain send call was reached"
 * apart from a provable pre-broadcast failure (see EvmStrategy#doPayout). Anything else must
 * propagate unchanged.
 */

import { BigNumber } from 'ethers';
import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutEvmService } from '../payout-evm.service';

// PayoutEvmService is abstract - it has no chain-specific behaviour of its own, so a bare
// subclass is enough to exercise it.
class PayoutEvmServiceWrapper extends PayoutEvmService {}

describe('PayoutEvmService', () => {
  let client: EvmClient;
  let service: PayoutEvmService;
  let sendNativeCoinFromDexSpy: jest.SpyInstance;
  let sendTokenFromDexSpy: jest.SpyInstance;

  beforeEach(() => {
    client = mock<EvmClient>();
    const evmService = mock<EvmService>();
    jest.spyOn(evmService, 'getDefaultClient').mockReturnValue(client);
    sendNativeCoinFromDexSpy = jest.spyOn(client, 'sendNativeCoinFromDex');
    sendTokenFromDexSpy = jest.spyOn(client, 'sendTokenFromDex');

    service = new PayoutEvmServiceWrapper(evmService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNativeCoin(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('rpc rejected the tx');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('rpc rejected the tx');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates a non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the tx hash on success and forwards address/amount/nonce', async () => {
      sendNativeCoinFromDexSpy.mockResolvedValue('TX_HASH_01');

      await expect(service.sendNativeCoin('ADDR_01', 1.5, 7)).resolves.toBe('TX_HASH_01');
      expect(sendNativeCoinFromDexSpy).toHaveBeenCalledWith('ADDR_01', 1.5, 7);
    });
  });

  describe('sendToken(...)', () => {
    const asset = createDefaultAsset();

    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('rpc rejected the token tx');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('rpc rejected the token tx');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates a non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the tx hash on success and forwards address/asset/amount/nonce', async () => {
      sendTokenFromDexSpy.mockResolvedValue('TX_HASH_02');

      await expect(service.sendToken('ADDR_01', asset, 2.5, 9)).resolves.toBe('TX_HASH_02');
      expect(sendTokenFromDexSpy).toHaveBeenCalledWith('ADDR_01', asset, 2.5, 9);
    });
  });

  // Happy-path coverage for the read-side of the EVM payout lifecycle: completion polling, gas
  // estimation, nonce lookup and expiry detection. The broadcast-boundary (sendNativeCoin/sendToken)
  // is covered above; this is the "everything went fine" half of the same service.
  describe('getPayoutCompletionData(...)', () => {
    it('returns pending when there is no receipt yet (tx not yet mined)', async () => {
      jest.spyOn(client, 'getTxReceipt').mockResolvedValue(null as any);

      const result = await service.getPayoutCompletionData('TX_NO_RECEIPT');

      expect(client.getTxReceipt).toHaveBeenCalledWith('TX_NO_RECEIPT');
      expect(result).toEqual({ state: 'pending' });
    });

    it('returns pending when the receipt has zero confirmations (reorg-vulnerable)', async () => {
      jest.spyOn(client, 'getTxReceipt').mockResolvedValue({ confirmations: 0, status: 1 } as any);

      const result = await service.getPayoutCompletionData('TX_ZERO_CONF');

      expect(result).toEqual({ state: 'pending' });
    });

    it('returns complete with the actual fee + exact fee wei when the receipt is confirmed and successful (status 1)', async () => {
      jest.spyOn(client, 'getTxReceipt').mockResolvedValue({ confirmations: 3, status: 1 } as any);
      jest.spyOn(client, 'getTxActualFee').mockResolvedValue(0.00042);
      jest.spyOn(client, 'getTxActualFeeBaseUnits').mockResolvedValue(420000000000000n);

      const result = await service.getPayoutCompletionData('TX_OK');

      expect(client.getTxActualFee).toHaveBeenCalledWith('TX_OK');
      expect(result).toEqual({ state: 'complete', fee: 0.00042, feeBaseUnits: 420000000000000n });
    });

    it('degrades feeBaseUnits to null (fail-open) when the exact fee capture throws (#4287 stage 3)', async () => {
      jest.spyOn(client, 'getTxReceipt').mockResolvedValue({ confirmations: 3, status: 1 } as any);
      jest.spyOn(client, 'getTxActualFee').mockResolvedValue(0.00042);
      jest.spyOn(client, 'getTxActualFeeBaseUnits').mockRejectedValue(new Error('rpc down'));

      const result = await service.getPayoutCompletionData('TX_OK');

      expect(result).toEqual({ state: 'complete', fee: 0.00042, feeBaseUnits: null });
    });

    it('returns failed + isOutOfGas=true when the tx reverted and consumed exactly the gas limit', async () => {
      jest
        .spyOn(client, 'getTxReceipt')
        .mockResolvedValue({ confirmations: 5, status: 0, gasUsed: BigNumber.from(21000) } as any);
      jest.spyOn(client, 'getTx').mockResolvedValue({ gasLimit: BigNumber.from(21000) } as any);

      const result = await service.getPayoutCompletionData('TX_OOG');

      expect(client.getTx).toHaveBeenCalledWith('TX_OOG');
      expect(result).toEqual({ state: 'failed', isOutOfGas: true });
    });

    it('returns failed + isOutOfGas=false when the tx reverted without exhausting the gas limit', async () => {
      jest
        .spyOn(client, 'getTxReceipt')
        .mockResolvedValue({ confirmations: 5, status: 0, gasUsed: BigNumber.from(15000) } as any);
      jest.spyOn(client, 'getTx').mockResolvedValue({ gasLimit: BigNumber.from(21000) } as any);

      const result = await service.getPayoutCompletionData('TX_REVERT');

      expect(result).toEqual({ state: 'failed', isOutOfGas: false });
    });

    it('returns failed + isOutOfGas=false when the failed tx can no longer be found (tx is null)', async () => {
      jest
        .spyOn(client, 'getTxReceipt')
        .mockResolvedValue({ confirmations: 5, status: 0, gasUsed: BigNumber.from(15000) } as any);
      jest.spyOn(client, 'getTx').mockResolvedValue(null as any);

      const result = await service.getPayoutCompletionData('TX_GONE');

      expect(result).toEqual({ state: 'failed', isOutOfGas: false });
    });
  });

  describe('getCurrentGasForCoinTransaction(...)', () => {
    it('delegates to the client', async () => {
      jest.spyOn(client, 'getCurrentGasCostForCoinTransaction').mockResolvedValue(123);

      await expect(service.getCurrentGasForCoinTransaction()).resolves.toBe(123);
      expect(client.getCurrentGasCostForCoinTransaction).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentGasForTokenTransaction(...)', () => {
    it('delegates to the client, forwarding the token asset', async () => {
      const token = createDefaultAsset();
      jest.spyOn(client, 'getCurrentGasCostForTokenTransaction').mockResolvedValue(456);

      await expect(service.getCurrentGasForTokenTransaction(token)).resolves.toBe(456);
      expect(client.getCurrentGasCostForTokenTransaction).toHaveBeenCalledWith(token);
    });
  });

  describe('getTxNonce(...)', () => {
    it('delegates to the client', async () => {
      jest.spyOn(client, 'getTxNonce').mockResolvedValue(7);

      await expect(service.getTxNonce('TX_N')).resolves.toBe(7);
      expect(client.getTxNonce).toHaveBeenCalledWith('TX_N');
    });
  });

  describe('isTxExpired(...)', () => {
    it('returns false without checking the tx when the RPC is stale (not synced, age >= 300s)', async () => {
      jest.spyOn(client, 'getLatestBlockTimestamp').mockResolvedValue(Date.now() / 1000 - 1000);
      const getTxSpy = jest.spyOn(client, 'getTx');

      await expect(service.isTxExpired('TX_STALE_RPC')).resolves.toBe(false);

      expect(getTxSpy).not.toHaveBeenCalled();
    });

    it('returns true when the RPC is synced and the tx can no longer be found (dropped from mempool)', async () => {
      jest.spyOn(client, 'getLatestBlockTimestamp').mockResolvedValue(Date.now() / 1000 - 5);
      jest.spyOn(client, 'getTx').mockResolvedValue(null as any);

      await expect(service.isTxExpired('TX_DROPPED')).resolves.toBe(true);

      expect(client.getTx).toHaveBeenCalledWith('TX_DROPPED');
    });

    it('returns false when the RPC is synced and the tx is still found (not expired)', async () => {
      jest.spyOn(client, 'getLatestBlockTimestamp').mockResolvedValue(Date.now() / 1000 - 5);
      jest.spyOn(client, 'getTx').mockResolvedValue({ hash: 'TX_STILL_THERE' } as any);

      await expect(service.isTxExpired('TX_STILL_THERE')).resolves.toBe(false);
    });
  });
});
