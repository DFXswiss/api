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
import { LndRouteDto } from 'src/integration/lightning/dto/lnd.dto';
import { LightningClient } from 'src/integration/lightning/lightning-client';
import { LightningService } from 'src/integration/lightning/services/lightning.service';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutLightningService } from '../payout-lightning.service';

describe('PayoutLightningService', () => {
  let lightningService: LightningService;
  let client: LightningClient;
  let service: PayoutLightningService;
  let sendTransferSpy: jest.SpyInstance;

  beforeEach(() => {
    lightningService = mock<LightningService>();
    client = mock<LightningClient>();
    jest.spyOn(lightningService, 'getDefaultClient').mockReturnValue(client);
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

    it('returns the tx id for a keysend (LN_NID) with a non-empty payment hash', async () => {
      sendTransferSpy.mockResolvedValue('TX_ID_KEYSEND');

      await expect(service.sendPayment('LNNID03aabbccddeeff', 0.001)).resolves.toBe('TX_ID_KEYSEND');
    });

    it('wraps a keysend (LN_NID) empty payment hash fail-closed, since a re-broadcast has no dedup', async () => {
      sendTransferSpy.mockResolvedValue('');

      let error: unknown;
      try {
        await service.sendPayment('LNNID03aabbccddeeff', 0.001);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Lightning keysend returned an empty payment hash');
    });

    it('returns an empty payment hash unchanged for a non-keysend (invoice payment_hash dedup covers a retry)', async () => {
      sendTransferSpy.mockResolvedValue('');

      await expect(service.sendPayment('ADDR_01', 0.001)).resolves.toBe('');
    });
  });

  describe('isHealthy()', () => {
    it('delegates to the default client', async () => {
      const isHealthySpy = jest.spyOn(client, 'isHealthy').mockResolvedValue(true);

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(isHealthySpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEstimatedFee(...)', () => {
    const route = (totalFeesMsat: number): LndRouteDto => ({
      total_fees_msat: totalFeesMsat,
      total_amt_msat: totalFeesMsat + 1000,
      hops: [{ chan_id: '1', amt_to_forward_msat: 1000, fee_msat: totalFeesMsat, pub_key: 'HOP_PK' }],
    });

    it('resolves the public key, queries routes and returns the most expensive route fee in BTC', async () => {
      const getPublicKeySpy = jest.spyOn(lightningService, 'getPublicKeyOfAddress').mockResolvedValue('PUBKEY_01');
      const getRoutesSpy = jest.spyOn(client, 'getLndRoutes').mockResolvedValue([route(1000), route(2000)]);

      // max(1000, 2000, 0) msat = 2000 msat = 2 sat = 0.00000002 BTC
      await expect(service.getEstimatedFee('addr@dfx.swiss', 0.001)).resolves.toBe(0.00000002);
      expect(getPublicKeySpy).toHaveBeenCalledWith('addr@dfx.swiss');
      expect(getRoutesSpy).toHaveBeenCalledWith('PUBKEY_01', 0.001);
    });

    it('returns 0 when no route is available (Math.max seed)', async () => {
      jest.spyOn(lightningService, 'getPublicKeyOfAddress').mockResolvedValue('PUBKEY_01');
      jest.spyOn(client, 'getLndRoutes').mockResolvedValue([]);

      await expect(service.getEstimatedFee('addr@dfx.swiss', 0.001)).resolves.toBe(0);
    });
  });

  describe('getPayoutCompletionData(...)', () => {
    it('delegates to the shared lightning service', async () => {
      const completionSpy = jest.spyOn(lightningService, 'getTransferCompletionData');
      completionSpy.mockResolvedValue([true, 0.00000002]);

      await expect(service.getPayoutCompletionData('TX_ID_01')).resolves.toEqual([true, 0.00000002]);
      expect(completionSpy).toHaveBeenCalledWith('TX_ID_01');
    });
  });
});
