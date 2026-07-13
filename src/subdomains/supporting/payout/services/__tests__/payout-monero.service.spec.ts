/**
 * Unit Tests for PayoutMoneroService
 *
 * Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
 * MoneroClient means the on-chain send was reached (tx may already be relayed) and must surface
 * as PayoutBroadcastException so BitcoinBasedStrategy#send keeps the order PAYOUT_DESIGNATED
 * (fail-closed) instead of rolling back and risking a double-spend on retry.
 */

import { MoneroClient } from 'src/integration/blockchain/monero/monero-client';
import { MoneroService } from 'src/integration/blockchain/monero/services/monero.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutGroup } from '../base/payout-bitcoin-based.service';
import { PayoutMoneroService } from '../payout-monero.service';

describe('PayoutMoneroService', () => {
  let service: PayoutMoneroService;
  let mockClient: jest.Mocked<MoneroClient>;
  let sendTransfersSpy: jest.Mock;
  let getTransactionSpy: jest.Mock;
  let getUnlockedBalanceSpy: jest.Mock;
  let getFeeEstimateSpy: jest.Mock;
  let isHealthySpy: jest.Mock;

  beforeEach(() => {
    sendTransfersSpy = jest.fn().mockResolvedValue({ txid: 'TX_HASH_01', amount: 1.5, fee: 0.01 });
    getTransactionSpy = jest.fn();
    getUnlockedBalanceSpy = jest.fn();
    getFeeEstimateSpy = jest.fn();
    isHealthySpy = jest.fn();

    mockClient = {
      sendTransfers: sendTransfersSpy,
      getTransaction: getTransactionSpy,
      getUnlockedBalance: getUnlockedBalanceSpy,
      getFeeEstimate: getFeeEstimateSpy,
    } as unknown as jest.Mocked<MoneroClient>;

    const mockMoneroService = {
      getDefaultClient: jest.fn().mockReturnValue(mockClient),
      isHealthy: isHealthySpy,
    } as unknown as jest.Mocked<MoneroService>;

    service = new PayoutMoneroService(mockMoneroService);
  });

  describe('sendToMany()', () => {
    it('should propagate the tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];

      const result = await service.sendToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(result).toBe('TX_HASH_01');
    });

    it('should wrap a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      const cause = new TxBroadcastError('Failed to send tx');
      sendTransfersSpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.sendToMany(PayoutOrderContext.BUY_CRYPTO, payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Failed to send tx');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the client unchanged', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      const plainError = new Error('unrelated client error');
      sendTransfersSpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.sendToMany(PayoutOrderContext.BUY_CRYPTO, payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('throws a descriptive error when a successful call returns no transfer', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      sendTransfersSpy.mockResolvedValueOnce(undefined);

      await expect(service.sendToMany(PayoutOrderContext.BUY_CRYPTO, payout)).rejects.toThrow(
        'Error while sending payment by Monero ADDR_01',
      );
    });
  });

  describe('isHealthy()', () => {
    it('delegates to the shared service', async () => {
      isHealthySpy.mockResolvedValue(true);

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(isHealthySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUnlockedBalance()', () => {
    it('delegates to the default client', async () => {
      getUnlockedBalanceSpy.mockResolvedValue(3.5);

      await expect(service.getUnlockedBalance()).resolves.toBe(3.5);
      expect(getUnlockedBalanceSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getPayoutCompletionData()', () => {
    it('returns [true, txnFee] once the tx is mined with confirmations', async () => {
      getTransactionSpy.mockResolvedValue({ block_height: 100, confirmations: 5, txnFee: 0.0002 });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([true, 0.0002]);
      expect(getTransactionSpy).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('defaults the fee to 0 for a complete tx that carries no txnFee', async () => {
      getTransactionSpy.mockResolvedValue({ block_height: 100, confirmations: 5 });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([true, 0]);
    });

    it('returns [false, 0] while the tx has no confirmations', async () => {
      getTransactionSpy.mockResolvedValue({ block_height: 100, confirmations: 0, txnFee: 0.0002 });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([false, 0]);
    });
  });

  describe('getEstimatedFee()', () => {
    it('returns the slow-priority base fee from the estimate', async () => {
      getFeeEstimateSpy.mockResolvedValue({ fee: 0, fees: [0.00012, 0.0002, 0.0003, 0.0004], status: 'OK' });

      await expect(service.getEstimatedFee()).resolves.toBe(0.00012);
      expect(getFeeEstimateSpy).toHaveBeenCalledTimes(1);
    });
  });
});
