/**
 * Unit Tests for PayoutZanoService
 *
 * Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
 * ZanoService/ZanoClient means the on-chain send was reached (tx may already be relayed) and must
 * surface as PayoutBroadcastException so ZanoStrategy#send (via BitcoinBasedStrategy) keeps the
 * order PAYOUT_DESIGNATED (fail-closed) instead of rolling back and risking a double-spend.
 */

import { ZanoService } from 'src/integration/blockchain/zano/services/zano.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutGroup } from '../base/payout-bitcoin-based.service';
import { PayoutZanoService } from '../payout-zano.service';

describe('PayoutZanoService', () => {
  let service: PayoutZanoService;
  let sendCoinsSpy: jest.Mock;
  let sendTokensSpy: jest.Mock;

  beforeEach(() => {
    sendCoinsSpy = jest.fn().mockResolvedValue({ txId: 'COIN_TX_01', amount: 1.5, fee: 0.01 });
    sendTokensSpy = jest.fn().mockResolvedValue({ txId: 'TOKEN_TX_01', amount: 1.5, fee: 0.01 });

    const mockZanoService = {
      sendCoins: sendCoinsSpy,
      sendTokens: sendTokensSpy,
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
});
