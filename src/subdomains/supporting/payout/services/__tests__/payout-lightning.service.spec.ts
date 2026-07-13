/**
 * Unit tests for the broadcast-boundary mapping in PayoutLightningService: sendPayment catches a
 * TxBroadcastError from the (shared, non-payout-specific - also used by PayIn) LightningService and
 * re-throws it as a PayoutBroadcastException, so the payout strategy can tell "the LND send-payment
 * call was reached" apart from a provable pre-broadcast/in-band failure (see LightningStrategy#
 * doPayout via PayoutStrategy#handleBroadcastError). Anything else - including the plain Error
 * LightningService#sendTransfer throws for an in-band LND payment_error ("no route" etc., see
 * lightning.service.ts) - must propagate unchanged so the order self-heals.
 *
 * One exception: a keysend (LN_NID) payment carries no invoice payment_hash, so LND cannot
 * deduplicate a re-broadcast. Every keysend failure is therefore wrapped fail-closed (as a
 * PayoutBroadcastException), even a plain in-band error, to prevent a double-pay on retry.
 */

import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutLightningService } from '../payout-lightning.service';

describe('PayoutLightningService', () => {
  let lightningService: LightningService;
  let service: PayoutLightningService;
  let sendTransferSpy: jest.SpyInstance;

  beforeEach(() => {
    lightningService = mock<LightningService>();
    jest.spyOn(lightningService, 'getDefaultClient').mockReturnValue(mock<LightningClient>());
    sendTransferSpy = jest.spyOn(lightningService, 'sendTransfer');

    service = new PayoutLightningService(lightningService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendPayment(...)', () => {
    it('wraps a TxBroadcastError (transport/timeout to the LND node) into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('socket hang up');
      sendTransferSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendPayment('ADDR_01', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('socket hang up');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates an in-band "no route" payment failure (plain Error) unchanged, so the order self-heals', async () => {
      const cause = new Error('Error while sending payment by LNURL ADDR_01: FAILURE_REASON_NO_ROUTE');
      sendTransferSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendPayment('ADDR_01', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('wraps a keysend (LN_NID) in-band failure fail-closed, since it has no payment_hash for LND dedup', async () => {
      const cause = new Error('Error while sending payment by LNURL LNNID03aabb: FAILURE_REASON_NO_ROUTE');
      sendTransferSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendPayment('LNNID03aabbccddeeff', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe(cause.message);
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('wraps a keysend (LN_NID) non-Error rejection fail-closed, stringifying the reason', async () => {
      sendTransferSpy.mockRejectedValue('raw string failure');

      let error: unknown;
      try {
        await service.sendPayment('LNNID03aabbccddeeff', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('raw string failure');
      expect((error as PayoutBroadcastException).cause).toBe('raw string failure');
    });

    it('propagates any other non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendTransferSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendPayment('ADDR_01', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the tx id on success and forwards address/amount', async () => {
      sendTransferSpy.mockResolvedValue('TX_ID_01');

      await expect(service.sendPayment('ADDR_01', 0.001)).resolves.toBe('TX_ID_01');
      expect(sendTransferSpy).toHaveBeenCalledWith('ADDR_01', 0.001);
    });
  });
});
