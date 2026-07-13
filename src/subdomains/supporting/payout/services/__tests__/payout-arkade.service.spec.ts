/**
 * Unit tests for the broadcast-boundary mapping in PayoutArkadeService: sendTransaction catches a
 * TxBroadcastError from the (shared, non-payout-specific) ArkadeService/ArkadeClient and re-throws it
 * as a PayoutBroadcastException, so the payout strategy can tell "wallet.sendBitcoin was reached"
 * apart from a provable pre-broadcast failure (see ArkadeStrategy#doPayout via
 * PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { ArkadeService } from 'src/integration/blockchain/arkade/arkade.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutArkadeService } from '../payout-arkade.service';

describe('PayoutArkadeService', () => {
  let arkadeService: ArkadeService;
  let service: PayoutArkadeService;
  let sendTransactionSpy: jest.SpyInstance;

  beforeEach(() => {
    arkadeService = mock<ArkadeService>();
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
});
