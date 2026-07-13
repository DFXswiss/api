/**
 * Unit tests for the broadcast-boundary mapping in PayoutArkadeService: sendTransaction catches a
 * TxBroadcastError from the (shared, non-payout-specific) ArkadeService/ArkadeClient and re-throws it
 * as a PayoutBroadcastException, so the payout strategy can tell "wallet.sendBitcoin was reached"
 * apart from a provable pre-broadcast failure (see ArkadeStrategy#doPayout via
 * PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { ArkadeClient } from 'src/integration/blockchain/arkade/arkade-client';
import { ArkadeService } from 'src/integration/blockchain/arkade/arkade.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutArkadeService } from '../payout-arkade.service';

describe('PayoutArkadeService', () => {
  let arkadeService: ArkadeService;
  let arkadeClient: ArkadeClient;
  let service: PayoutArkadeService;
  let sendTransactionSpy: jest.SpyInstance;

  beforeEach(() => {
    arkadeService = mock<ArkadeService>();
    arkadeClient = mock<ArkadeClient>();
    jest.spyOn(arkadeService, 'getDefaultClient').mockReturnValue(arkadeClient);
    sendTransactionSpy = jest.spyOn(arkadeService, 'sendTransaction');

    service = new PayoutArkadeService(arkadeService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendTransaction(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('sendBitcoin failed');
      sendTransactionSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendTransaction('ARK_ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('sendBitcoin failed');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates a non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendTransactionSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendTransaction('ARK_ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the txid on success and forwards address/amount', async () => {
      sendTransactionSpy.mockResolvedValue({ txid: 'TX_HASH_01', fee: 0 });

      await expect(service.sendTransaction('ARK_ADDR_01', 1.5)).resolves.toBe('TX_HASH_01');
      expect(sendTransactionSpy).toHaveBeenCalledWith('ARK_ADDR_01', 1.5);
    });
  });

  describe('isHealthy()', () => {
    it('delegates to the shared service', async () => {
      const isHealthySpy = jest.spyOn(arkadeService, 'isHealthy').mockResolvedValue(true);

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(isHealthySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPayoutCompletionData(...)', () => {
    it('returns [true, actualFee] once the tx is complete', async () => {
      const isTxCompleteSpy = jest.spyOn(arkadeClient, 'isTxComplete').mockResolvedValue(true);
      const getTxActualFeeSpy = jest.spyOn(arkadeService, 'getTxActualFee').mockResolvedValue(0.0001);

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([true, 0.0001]);
      expect(isTxCompleteSpy).toHaveBeenCalledWith('TX_HASH_01');
      expect(getTxActualFeeSpy).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('returns [false, 0] and never reads the fee while the tx is not complete', async () => {
      jest.spyOn(arkadeClient, 'isTxComplete').mockResolvedValue(false);
      const getTxActualFeeSpy = jest.spyOn(arkadeService, 'getTxActualFee');

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([false, 0]);
      expect(getTxActualFeeSpy).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentFeeForTransaction(...)', () => {
    it('returns the native fee for a coin asset', async () => {
      const coin = createCustomAsset({ type: AssetType.COIN });
      const getNativeFeeSpy = jest.spyOn(arkadeService, 'getNativeFee').mockResolvedValue(0.00001);

      await expect(service.getCurrentFeeForTransaction(coin)).resolves.toBe(0.00001);
      expect(getNativeFeeSpy).toHaveBeenCalledTimes(1);
    });

    it('throws for a non-coin asset without touching the native fee', () => {
      const token = createDefaultAsset(); // AssetType.TOKEN
      const getNativeFeeSpy = jest.spyOn(arkadeService, 'getNativeFee');

      expect(() => service.getCurrentFeeForTransaction(token)).toThrow('Method not implemented');
      expect(getNativeFeeSpy).not.toHaveBeenCalled();
    });
  });
});
