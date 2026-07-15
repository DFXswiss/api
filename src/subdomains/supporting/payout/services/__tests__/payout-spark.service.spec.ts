/**
 * Unit tests for the broadcast-boundary mapping in PayoutSparkService: sendTransaction catches a
 * TxBroadcastError from the (shared, non-payout-specific) SparkService/SparkClient and re-throws it
 * as a PayoutBroadcastException, so the payout strategy can tell "wallet.transfer was reached" apart
 * from a provable pre-broadcast failure (see SparkStrategy#doPayout via
 * PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { SparkClient } from 'src/integration/blockchain/spark/spark-client';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutSparkService } from '../payout-spark.service';

describe('PayoutSparkService', () => {
  let sparkService: SparkService;
  let sparkClient: SparkClient;
  let service: PayoutSparkService;
  let sendTransactionSpy: jest.SpyInstance;

  beforeEach(() => {
    sparkService = mock<SparkService>();
    sparkClient = mock<SparkClient>();
    jest.spyOn(sparkService, 'getDefaultClient').mockReturnValue(sparkClient);
    sendTransactionSpy = jest.spyOn(sparkService, 'sendTransaction');

    service = new PayoutSparkService(sparkService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendTransaction(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('transfer failed');
      sendTransactionSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendTransaction('SPARK_ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('transfer failed');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates a non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendTransactionSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendTransaction('SPARK_ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the txid on success and forwards address/amount', async () => {
      sendTransactionSpy.mockResolvedValue({ txid: 'TX_HASH_01', fee: 0 });

      await expect(service.sendTransaction('SPARK_ADDR_01', 1.5)).resolves.toBe('TX_HASH_01');
      expect(sendTransactionSpy).toHaveBeenCalledWith('SPARK_ADDR_01', 1.5);
    });
  });

  describe('isHealthy()', () => {
    it('delegates to the shared service', async () => {
      const isHealthySpy = jest.spyOn(sparkService, 'isHealthy').mockResolvedValue(true);

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(isHealthySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPayoutCompletionData(...)', () => {
    it('returns [true, actualFee] once the tx is complete', async () => {
      const isTxCompleteSpy = jest.spyOn(sparkClient, 'isTxComplete').mockResolvedValue(true);
      const getTxActualFeeSpy = jest.spyOn(sparkService, 'getTxActualFee').mockResolvedValue(0.0001);

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([true, 0.0001]);
      expect(isTxCompleteSpy).toHaveBeenCalledWith('TX_HASH_01');
      expect(getTxActualFeeSpy).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('returns [false, 0] and never reads the fee while the tx is not complete', async () => {
      jest.spyOn(sparkClient, 'isTxComplete').mockResolvedValue(false);
      const getTxActualFeeSpy = jest.spyOn(sparkService, 'getTxActualFee');

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([false, 0]);
      expect(getTxActualFeeSpy).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentFeeForTransaction(...)', () => {
    it('returns the native fee for a coin asset', async () => {
      const coin = createCustomAsset({ type: AssetType.COIN });
      const getNativeFeeSpy = jest.spyOn(sparkService, 'getNativeFee').mockResolvedValue(0.00001);

      await expect(service.getCurrentFeeForTransaction(coin)).resolves.toBe(0.00001);
      expect(getNativeFeeSpy).toHaveBeenCalledTimes(1);
    });

    it('throws for a non-coin asset without touching the native fee', () => {
      const token = createDefaultAsset(); // AssetType.TOKEN
      const getNativeFeeSpy = jest.spyOn(sparkService, 'getNativeFee');

      expect(() => service.getCurrentFeeForTransaction(token)).toThrow('Method not implemented');
      expect(getNativeFeeSpy).not.toHaveBeenCalled();
    });
  });
});
