/**
 * Unit tests for the broadcast-boundary mapping in PayoutEvmService: sendNativeCoin/sendToken
 * catch a TxBroadcastError from the (shared, non-payout-specific) EvmClient and re-throw it as a
 * PayoutBroadcastException, so the payout strategy can tell "the on-chain send call was reached"
 * apart from a provable pre-broadcast failure (see EvmStrategy#doPayout). Anything else must
 * propagate unchanged.
 */

import { mock } from 'jest-mock-extended';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { EvmClient } from 'src/integration/blockchain/shared/evm/evm-client';
import { EvmService } from 'src/integration/blockchain/shared/evm/evm.service';
import { createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutEvmService } from '../payout-evm.service';

// PayoutEvmService is abstract - it has no chain-specific behaviour of its own, so a bare
// subclass is enough to exercise it.
class PayoutEvmServiceWrapper extends PayoutEvmService {}

describe('PayoutEvmService', () => {
  let client: EvmClient;
  let service: PayoutEvmService;
  let sendNativeCoinFromDexSpy: jest.SpyInstance;
  let sendTokenFromDexSpy: jest.SpyInstance;

  beforeEach(() => {
    client = mock<EvmClient>();
    const evmService = mock<EvmService>();
    jest.spyOn(evmService, 'getDefaultClient').mockReturnValue(client);
    sendNativeCoinFromDexSpy = jest.spyOn(client, 'sendNativeCoinFromDex');
    sendTokenFromDexSpy = jest.spyOn(client, 'sendTokenFromDex');

    service = new PayoutEvmServiceWrapper(evmService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('sendNativeCoin(...)', () => {
    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('rpc rejected the tx');
      sendNativeCoinFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendNativeCoin('ADDR_01', 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('rpc rejected the tx');
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

    it('returns the tx hash on success and forwards address/amount/nonce', async () => {
      sendNativeCoinFromDexSpy.mockResolvedValue('TX_HASH_01');

      await expect(service.sendNativeCoin('ADDR_01', 1.5, 7)).resolves.toBe('TX_HASH_01');
      expect(sendNativeCoinFromDexSpy).toHaveBeenCalledWith('ADDR_01', 1.5, 7);
    });
  });

  describe('sendToken(...)', () => {
    const asset = createDefaultAsset();

    it('wraps a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const cause = new TxBroadcastError('rpc rejected the token tx');
      sendTokenFromDexSpy.mockRejectedValue(cause);

      let error: unknown;
      try {
        await service.sendToken('ADDR_01', asset, 1);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('rpc rejected the token tx');
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

    it('returns the tx hash on success and forwards address/asset/amount/nonce', async () => {
      sendTokenFromDexSpy.mockResolvedValue('TX_HASH_02');

      await expect(service.sendToken('ADDR_01', asset, 2.5, 9)).resolves.toBe('TX_HASH_02');
      expect(sendTokenFromDexSpy).toHaveBeenCalledWith('ADDR_01', asset, 2.5, 9);
    });
  });
});
