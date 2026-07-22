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

  describe('getPayoutCompletionData(...)', () => {
    it('returns [true, actualFee, feeBaseUnits] and reads the actual fee once the tx is complete', async () => {
      const isTxCompleteSpy = jest.spyOn(cardanoService, 'isTxComplete').mockResolvedValue(true);
      const getTxActualFeeSpy = jest.spyOn(cardanoService, 'getTxActualFee').mockResolvedValue(0.17);
      // §2.3 exactness (issue #4287): the exact fee lovelace are captured verbatim alongside the float
      const getTxActualFeeBaseUnitsSpy = jest
        .spyOn(cardanoService, 'getTxActualFeeBaseUnits')
        .mockResolvedValue(170000n);

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([true, 0.17, 170000n]);
      expect(isTxCompleteSpy).toHaveBeenCalledWith('TX_HASH_01');
      expect(getTxActualFeeSpy).toHaveBeenCalledWith('TX_HASH_01');
      expect(getTxActualFeeBaseUnitsSpy).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('returns [false, 0, null] and never reads the fee while the tx is not complete', async () => {
      const isTxCompleteSpy = jest.spyOn(cardanoService, 'isTxComplete').mockResolvedValue(false);
      const getTxActualFeeSpy = jest.spyOn(cardanoService, 'getTxActualFee');
      const getTxActualFeeBaseUnitsSpy = jest.spyOn(cardanoService, 'getTxActualFeeBaseUnits');

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([false, 0, null]);
      expect(isTxCompleteSpy).toHaveBeenCalledWith('TX_HASH_01');
      expect(getTxActualFeeSpy).not.toHaveBeenCalled();
      expect(getTxActualFeeBaseUnitsSpy).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentGasForCoinTransaction()', () => {
    it('delegates to the shared service', async () => {
      const gasSpy = jest.spyOn(cardanoService, 'getCurrentGasCostForCoinTransaction').mockResolvedValue(1.23);

      await expect(service.getCurrentGasForCoinTransaction()).resolves.toBe(1.23);
      expect(gasSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentGasForTokenTransaction(...)', () => {
    const asset = createDefaultAsset();

    it('delegates to the shared service, forwarding the token', async () => {
      const gasSpy = jest.spyOn(cardanoService, 'getCurrentGasCostForTokenTransaction').mockResolvedValue(2.34);

      await expect(service.getCurrentGasForTokenTransaction(asset)).resolves.toBe(2.34);
      expect(gasSpy).toHaveBeenCalledWith(asset);
    });
  });
});
