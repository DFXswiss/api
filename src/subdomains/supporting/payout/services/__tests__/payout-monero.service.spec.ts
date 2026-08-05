/**
 * Unit Tests for PayoutMoneroService
 *
 * The Monero payout path broadcasts in two phases (#4673). The build phase runs with do_not_relay, so
 * the wallet never reaches commit_tx and its failures are provably pre-broadcast — they must stay plain
 * and roll back for auto-retry. Only the relay phase can leave a transaction in flight, so only there
 * does a TxBroadcastError from the (shared, non-payout-specific) MoneroClient surface as a
 * PayoutBroadcastException, which keeps BitcoinBasedStrategy#send fail-closed by default.
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
  let buildTransferSpy: jest.Mock;
  let relayTransferSpy: jest.Mock;
  let isTxKnownSpy: jest.Mock;
  let getTransactionSpy: jest.Mock;
  let getUnlockedBalanceSpy: jest.Mock;
  let getFeeEstimateSpy: jest.Mock;
  let isHealthySpy: jest.Mock;

  beforeEach(() => {
    buildTransferSpy = jest.fn().mockResolvedValue({ txId: 'TX_HASH_01', metadata: 'META_01' });
    relayTransferSpy = jest.fn().mockResolvedValue('TX_HASH_01');
    isTxKnownSpy = jest.fn();
    getTransactionSpy = jest.fn();
    getUnlockedBalanceSpy = jest.fn();
    getFeeEstimateSpy = jest.fn();
    isHealthySpy = jest.fn();

    mockClient = {
      buildTransfer: buildTransferSpy,
      relayTransfer: relayTransferSpy,
      isTxKnown: isTxKnownSpy,
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

  describe('buildTransfer()', () => {
    const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];

    it('should propagate the signed transaction on success', async () => {
      await expect(service.buildTransfer(payout)).resolves.toEqual({ txId: 'TX_HASH_01', metadata: 'META_01' });
      expect(buildTransferSpy).toHaveBeenCalledWith(payout);
    });

    // Regression guard for the point of the split: the build phase runs with do_not_relay, so the wallet
    // never reaches commit_tx and reserves nothing. Wrapping its failures as PayoutBroadcastException
    // would park a provably safe order for a human — the escalation #4673 exists to remove.
    it('should NOT wrap a client failure into a PayoutBroadcastException', async () => {
      const plainError = new Error('no connection to daemon');
      buildTransferSpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.buildTransfer(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('throws a descriptive error when a successful call returns no transaction', async () => {
      buildTransferSpy.mockResolvedValueOnce(undefined);

      await expect(service.buildTransfer(payout)).rejects.toThrow('Error while building Monero payment ADDR_01');
    });
  });

  describe('relayTransfer()', () => {
    it('should propagate the relayed tx id on success', async () => {
      await expect(service.relayTransfer('META_01')).resolves.toBe('TX_HASH_01');
      expect(relayTransferSpy).toHaveBeenCalledWith('META_01');
    });

    it('should wrap a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('no connection to daemon');
      relayTransferSpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.relayTransfer('META_01');
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('no connection to daemon');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the client unchanged', async () => {
      const plainError = new Error('unrelated client error');
      relayTransferSpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.relayTransfer('META_01');
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });
  });

  describe('isTxKnown()', () => {
    it('delegates to the default client', async () => {
      isTxKnownSpy.mockResolvedValue(true);

      await expect(service.isTxKnown('TX_HASH_01')).resolves.toBe(true);
      expect(isTxKnownSpy).toHaveBeenCalledWith('TX_HASH_01');
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
