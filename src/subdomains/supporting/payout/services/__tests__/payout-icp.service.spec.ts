/**
 * Unit tests for the broadcast-boundary mapping in PayoutInternetComputerService: sendNativeCoin/
 * sendToken catch a TxBroadcastError from the (shared, non-payout-specific) InternetComputerClient
 * and re-throw it as a PayoutBroadcastException, so the payout strategy can tell "the IC update call
 * was reached" apart from a provable pre-broadcast failure (see InternetComputerStrategy#doPayout
 * via PayoutStrategy#handleBroadcastError). Anything else must propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { InternetComputerClient } from 'src/integration/blockchain/icp/icp-client';
import { InternetComputerService } from 'src/integration/blockchain/icp/services/icp.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutInternetComputerService } from '../payout-icp.service';

describe('PayoutInternetComputerService', () => {
  let client: InternetComputerClient;
  let service: PayoutInternetComputerService;
  let sendNativeCoinFromDexSpy: jest.SpyInstance;
  let sendTokenFromDexSpy: jest.SpyInstance;

  beforeEach(() => {
    client = mock<InternetComputerClient>();
    const internetComputerService = mock<InternetComputerService>();
    jest.spyOn(internetComputerService, 'getDefaultClient').mockReturnValue(client);
    sendNativeCoinFromDexSpy = jest.spyOn(client, 'sendNativeCoinFromDex');
    sendTokenFromDexSpy = jest.spyOn(client, 'sendTokenFromDex');

    service = new PayoutInternetComputerService(internetComputerService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNativeCoin(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('IC update call rejected');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('IC update call rejected');
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
      const cause = new TxBroadcastError('IC update call rejected for token transfer');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('IC update call rejected for token transfer');
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
    it('returns [false, 0] and reads no fee while the tx is not complete', async () => {
      jest.spyOn(client, 'isTxComplete').mockResolvedValue(false);
      const getTxActualFeeSpy = jest.spyOn(client, 'getTxActualFee');
      const tokenGasSpy = jest.spyOn(client, 'getCurrentGasCostForTokenTransaction');

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([false, 0]);
      expect(getTxActualFeeSpy).not.toHaveBeenCalled();
      expect(tokenGasSpy).not.toHaveBeenCalled();
    });

    it('reads the reverse-gas-model token cost (not the on-chain fee) for a complete token payout', async () => {
      const token = createDefaultAsset();
      jest.spyOn(client, 'isTxComplete').mockResolvedValue(true);
      const tokenGasSpy = jest.spyOn(client, 'getCurrentGasCostForTokenTransaction').mockResolvedValue(0.0002);
      const getTxActualFeeSpy = jest.spyOn(client, 'getTxActualFee');

      await expect(service.getPayoutCompletionData('TX_HASH_01', token)).resolves.toEqual([true, 0.0002]);
      expect(tokenGasSpy).toHaveBeenCalledWith(token);
      expect(getTxActualFeeSpy).not.toHaveBeenCalled();
    });

    it('reads the actual on-chain fee for a complete coin payout (no token)', async () => {
      jest.spyOn(client, 'isTxComplete').mockResolvedValue(true);
      const getTxActualFeeSpy = jest.spyOn(client, 'getTxActualFee').mockResolvedValue(0.0001);

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([true, 0.0001]);
      expect(getTxActualFeeSpy).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('falls back to the coin gas cost when the primary fee lookup throws', async () => {
      jest.spyOn(client, 'isTxComplete').mockResolvedValue(true);
      jest.spyOn(client, 'getTxActualFee').mockRejectedValue(new Error('ledger query failed'));
      const coinGasSpy = jest.spyOn(client, 'getCurrentGasCostForCoinTransaction').mockResolvedValue(0.00005);

      await expect(service.getPayoutCompletionData('TX_HASH_01')).resolves.toEqual([true, 0.00005]);
      expect(coinGasSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentGasForCoinTransaction()', () => {
    it('delegates to the default client', async () => {
      const gasSpy = jest.spyOn(client, 'getCurrentGasCostForCoinTransaction').mockResolvedValue(0.0001);

      await expect(service.getCurrentGasForCoinTransaction()).resolves.toBe(0.0001);
      expect(gasSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCurrentGasForTokenTransaction(...)', () => {
    const asset = createDefaultAsset();

    it('delegates to the default client, forwarding the token', async () => {
      const gasSpy = jest.spyOn(client, 'getCurrentGasCostForTokenTransaction').mockResolvedValue(0.0002);

      await expect(service.getCurrentGasForTokenTransaction(asset)).resolves.toBe(0.0002);
      expect(gasSpy).toHaveBeenCalledWith(asset);
    });
  });
});
