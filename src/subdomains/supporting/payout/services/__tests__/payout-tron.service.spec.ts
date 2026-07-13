/**
 * Unit tests for the broadcast-boundary mapping in PayoutTronService: sendNativeCoin/sendToken catch
 * a TxBroadcastError from the (shared, non-payout-specific) TronService/TronClient and re-throw it as
 * a PayoutBroadcastException, so the payout strategy can tell "the atomic sign+broadcast gateway call
 * was reached" apart from a provable pre-broadcast failure (see TronStrategy#doPayout via
 * PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { TronService } from 'src/integration/blockchain/tron/services/tron.service';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutTronService } from '../payout-tron.service';

describe('PayoutTronService', () => {
  let tronService: TronService;
  let service: PayoutTronService;
  let sendNativeCoinFromDexSpy: jest.SpyInstance;
  let sendTokenFromDexSpy: jest.SpyInstance;

  beforeEach(() => {
    tronService = mock<TronService>();
    sendNativeCoinFromDexSpy = jest.spyOn(tronService, 'sendNativeCoinFromDex');
    sendTokenFromDexSpy = jest.spyOn(tronService, 'sendTokenFromDex');

    service = new PayoutTronService(tronService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNativeCoin(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('gateway rejected the tx');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('gateway rejected the tx');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates a non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the tx hash on success and forwards address/amount', async () => {
      sendNativeCoinFromDexSpy.mockResolvedValue('TX_HASH_01');

      await expect(service.sendNativeCoin('ADDR_01', 1.5)).resolves.toBe('TX_HASH_01');
      expect(sendNativeCoinFromDexSpy).toHaveBeenCalledWith('ADDR_01', 1.5);
    });
  });

  describe('sendToken(...)', () => {
    const asset = createDefaultAsset();

    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('gateway rejected the trc20 tx');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('gateway rejected the trc20 tx');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('propagates a non-TxBroadcastError unchanged', async () => {
      const cause = new Error('unexpected failure');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(cause); // same object - not wrapped
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });

    it('returns the tx hash on success and forwards address/asset/amount', async () => {
      sendTokenFromDexSpy.mockResolvedValue('TX_HASH_02');

      await expect(service.sendToken('ADDR_01', asset, 2.5)).resolves.toBe('TX_HASH_02');
      expect(sendTokenFromDexSpy).toHaveBeenCalledWith('ADDR_01', asset, 2.5);
    });
  });
});
