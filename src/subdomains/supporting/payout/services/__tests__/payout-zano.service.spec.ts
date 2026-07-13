/**
 * Unit Tests for PayoutZanoService
 *
 * Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
 * ZanoService/ZanoClient means the on-chain send was reached (tx may already be relayed) and must
 * surface as PayoutBroadcastException so ZanoStrategy#send (via BitcoinBasedStrategy) keeps the
 * order PAYOUT_DESIGNATED (fail-closed) instead of rolling back and risking a double-spend.
 */

import { ZanoTransactionDto } from 'src/integration/blockchain/zano/dto/zano.dto';
import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutGroup } from '../base/payout-bitcoin-based.service';
import { PayoutZanoService } from '../payout-zano.service';

describe('PayoutZanoService', () => {
  let service: PayoutZanoService;
  let sendCoinsSpy: jest.Mock;
  let sendTokensSpy: jest.Mock;
  let isHealthySpy: jest.Mock;
  let getUnlockedCoinBalanceSpy: jest.Mock;
  let getUnlockedTokenBalanceSpy: jest.Mock;
  let getTransactionSpy: jest.Mock;
  let isTxCompleteSpy: jest.Mock;
  let getFeeEstimateSpy: jest.Mock;

  beforeEach(() => {
    sendCoinsSpy = jest.fn().mockResolvedValue({ txId: 'COIN_TX_01', amount: 1.5, fee: 0.01 });
    sendTokensSpy = jest.fn().mockResolvedValue({ txId: 'TOKEN_TX_01', amount: 1.5, fee: 0.01 });
    isHealthySpy = jest.fn();
    getUnlockedCoinBalanceSpy = jest.fn();
    getUnlockedTokenBalanceSpy = jest.fn();
    getTransactionSpy = jest.fn();
    isTxCompleteSpy = jest.fn();
    getFeeEstimateSpy = jest.fn();

    const mockZanoService = {
      sendCoins: sendCoinsSpy,
      sendTokens: sendTokensSpy,
      isHealthy: isHealthySpy,
      getUnlockedCoinBalance: getUnlockedCoinBalanceSpy,
      getUnlockedTokenBalance: getUnlockedTokenBalanceSpy,
      getTransaction: getTransactionSpy,
      isTxComplete: isTxCompleteSpy,
      getFeeEstimate: getFeeEstimateSpy,
    } as unknown as jest.Mocked<ZanoService>;

    service = new PayoutZanoService(mockZanoService);
  });

  describe('sendCoins()', () => {
    it('should propagate the tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];

      const result = await service.sendCoins(payout);

      expect(result).toBe('COIN_TX_01');
    });

    it('should wrap a TxBroadcastError from the service into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      const cause = new TxBroadcastError('Transfer not sent: response was {}');
      sendCoinsSpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Transfer not sent: response was {}');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the service unchanged', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      const plainError = new Error('Unlocked coin balance 0 less than amount + fee 1.51');
      sendCoinsSpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.sendCoins(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });
  });

  describe('sendTokens()', () => {
    it('should propagate the tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];

      const result = await service.sendTokens(payout, createDefaultAsset());

      expect(result).toBe('TOKEN_TX_01');
    });

    it('should wrap a TxBroadcastError from the service into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      const cause = new TxBroadcastError('Transfer not sent: response was {}');
      sendTokensSpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.sendTokens(payout, createDefaultAsset());
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Transfer not sent: response was {}');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the service unchanged', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 1.5 }];
      const plainError = new Error('Unlocked token balance 0 less than token amount 1.5');
      sendTokensSpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.sendTokens(payout, createDefaultAsset());
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });
  });

  describe('isHealthy()', () => {
    it('delegates to the shared service', async () => {
      isHealthySpy.mockResolvedValue(true);

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(isHealthySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUnlockedCoinBalance()', () => {
    it('delegates to the shared service', async () => {
      getUnlockedCoinBalanceSpy.mockResolvedValue(12.5);

      await expect(service.getUnlockedCoinBalance()).resolves.toBe(12.5);
      expect(getUnlockedCoinBalanceSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUnlockedTokenBalance(...)', () => {
    it('delegates to the shared service, forwarding the token', async () => {
      const token = createDefaultAsset();
      getUnlockedTokenBalanceSpy.mockResolvedValue(7.25);

      await expect(service.getUnlockedTokenBalance(token)).resolves.toBe(7.25);
      expect(getUnlockedTokenBalanceSpy).toHaveBeenCalledWith(token);
    });
  });

  describe('getPayoutCompletionData(...)', () => {
    const completeTx: ZanoTransactionDto = {
      id: 'TX_HASH_01',
      block: 100,
      amount: 1.5,
      fee: 0.01,
      status: 'confirmed',
      timestamp: '1700000000',
    };

    it('returns [true, fee] read from the fetched tx once it is complete', async () => {
      getTransactionSpy.mockResolvedValue(completeTx);
      isTxCompleteSpy.mockResolvedValue(true);

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([true, 0.01]);
      expect(getTransactionSpy).toHaveBeenCalledWith('TX_HASH_01');
      expect(isTxCompleteSpy).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('returns [false, 0] while the tx is not complete', async () => {
      getTransactionSpy.mockResolvedValue(completeTx);
      isTxCompleteSpy.mockResolvedValue(false);

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([false, 0]);
    });

    it('defaults the fee to 0 for a complete but fee-less tx (defensive ?? guard)', async () => {
      // fee is a required field on ZanoTransactionDto, so simulate a malformed/fee-less response
      // to exercise the `transaction.fee ?? 0` fallback branch.
      getTransactionSpy.mockResolvedValue({ ...completeTx, fee: undefined } as unknown as ZanoTransactionDto);
      isTxCompleteSpy.mockResolvedValue(true);

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([true, 0]);
    });
  });

  describe('getEstimatedFee()', () => {
    it('delegates to the shared service fee estimate', () => {
      getFeeEstimateSpy.mockReturnValue(0.005);

      expect(service.getEstimatedFee()).toBe(0.005);
      expect(getFeeEstimateSpy).toHaveBeenCalledTimes(1);
    });
  });
});
