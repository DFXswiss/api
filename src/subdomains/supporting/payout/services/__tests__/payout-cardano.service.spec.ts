/**
 * Unit tests for the broadcast-boundary mapping in PayoutCardanoService: sendNativeCoin/sendToken
 * catch a TxBroadcastError from the (shared, non-payout-specific) CardanoService/CardanoClient and
 * re-throw it as a PayoutBroadcastException, so the payout strategy can tell "the on-chain submit
 * call was reached" apart from a provable pre-broadcast failure (see CardanoStrategy#doPayout via
 * PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { CardanoService } from 'src/integration/blockchain/cardano/services/cardano.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutCardanoService } from '../payout-cardano.service';

describe('PayoutCardanoService', () => {
  let cardanoService: CardanoService;
  let service: PayoutCardanoService;
  let sendNativeCoinFromDexSpy: jest.SpyInstance;
  let sendTokenFromDexSpy: jest.SpyInstance;

  beforeEach(() => {
    cardanoService = mock<CardanoService>();
    sendNativeCoinFromDexSpy = jest.spyOn(cardanoService, 'sendNativeCoinFromDex');
    sendTokenFromDexSpy = jest.spyOn(cardanoService, 'sendTokenFromDex');

    service = new PayoutCardanoService(cardanoService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNativeCoin(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('BlockFrost rejected the tx');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('BlockFrost rejected the tx');
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
      const cause = new TxBroadcastError('BlockFrost rejected the token tx');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('BlockFrost rejected the token tx');
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
