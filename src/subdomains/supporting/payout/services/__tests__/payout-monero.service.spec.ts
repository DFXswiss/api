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

  beforeEach(() => {
    sendTransfersSpy = jest.fn().mockResolvedValue({ txid: 'TX_HASH_01', amount: 1.5, fee: 0.01 });

    mockClient = {
      sendTransfers: sendTransfersSpy,
    } as unknown as jest.Mocked<MoneroClient>;

    const mockMoneroService = {
      getDefaultClient: jest.fn().mockReturnValue(mockClient),
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
  });
});
