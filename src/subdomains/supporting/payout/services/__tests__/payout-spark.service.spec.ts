/**
 * Unit tests for the broadcast-boundary mapping in PayoutSparkService: sendTransaction catches a
 * TxBroadcastError from the (shared, non-payout-specific) SparkService/SparkClient and re-throws it
 * as a PayoutBroadcastException, so the payout strategy can tell "wallet.transfer was reached" apart
 * from a provable pre-broadcast failure (see SparkStrategy#doPayout via
 * PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { SparkService } from 'src/integration/blockchain/spark/spark.service';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutSparkService } from '../payout-spark.service';

describe('PayoutSparkService', () => {
  let sparkService: SparkService;
  let service: PayoutSparkService;
  let sendTransactionSpy: jest.SpyInstance;

  beforeEach(() => {
    sparkService = mock<SparkService>();
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
});
