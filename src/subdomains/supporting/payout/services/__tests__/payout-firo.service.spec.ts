/**
 * Unit Tests for PayoutFiroService
 *
 * Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
 * FiroClient means the on-chain send was reached (tx may be in-flight) and must surface as
 * PayoutBroadcastException so BitcoinBasedStrategy#send keeps the order PAYOUT_DESIGNATED
 * (fail-closed) instead of rolling back and risking a double-spend on retry.
 */

import { FiroClient } from 'src/integration/blockchain/firo/firo-client';
import { FiroFeeService } from 'src/integration/blockchain/firo/services/firo-fee.service';
import { FiroService } from 'src/integration/blockchain/firo/services/firo.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutGroup } from '../base/payout-bitcoin-based.service';
import { PayoutFiroService } from '../payout-firo.service';

describe('PayoutFiroService', () => {
  let service: PayoutFiroService;
  let mockClient: jest.Mocked<FiroClient>;
  let mockFeeService: jest.Mocked<FiroFeeService>;
  let sendManySpy: jest.Mock;
  let mintSparkSpy: jest.Mock;

  beforeEach(() => {
    sendManySpy = jest.fn().mockResolvedValue('TX_HASH_01');
    mintSparkSpy = jest.fn().mockResolvedValue('MINT_TX_HASH_01');

    mockClient = {
      sendMany: sendManySpy,
      mintSpark: mintSparkSpy,
      getInfo: jest.fn(),
      getTx: jest.fn(),
    } as unknown as jest.Mocked<FiroClient>;

    const mockFiroService = {
      getDefaultClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<FiroService>;

    mockFeeService = {
      getSendFeeRate: jest.fn().mockResolvedValue(10),
    } as unknown as jest.Mocked<FiroFeeService>;

    service = new PayoutFiroService(mockFiroService, mockFeeService);
  });

  describe('sendUtxoToMany()', () => {
    it('should propagate the tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];

      const result = await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(result).toBe('TX_HASH_01');
    });

    it('should wrap a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      const cause = new TxBroadcastError('Firo RPC sendrawtransaction failed');
      sendManySpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Firo RPC sendrawtransaction failed');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the client unchanged', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      const plainError = new Error('No non-deposit addresses with UTXOs available');
      sendManySpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });
  });

  describe('mintSpark()', () => {
    it('should propagate the tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'sparkAddr1', amount: 0.5 }];

      const result = await service.mintSpark(payout);

      expect(result).toBe('MINT_TX_HASH_01');
    });

    it('should wrap a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'sparkAddr1', amount: 0.5 }];
      const cause = new TxBroadcastError('Firo RPC mintspark failed');
      mintSparkSpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.mintSpark(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Firo RPC mintspark failed');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the client unchanged', async () => {
      const payout: PayoutGroup = [{ addressTo: 'sparkAddr1', amount: 0.5 }];
      const plainError = new Error('mintspark returned no transaction IDs');
      mintSparkSpy.mockRejectedValueOnce(plainError);

      let error: unknown;
      try {
        await service.mintSpark(payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(plainError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
    });
  });

  describe('isHealthy()', () => {
    it('returns true when the node reports info', async () => {
      (mockClient.getInfo as jest.Mock).mockResolvedValueOnce({ blocks: 500000 });

      await expect(service.isHealthy()).resolves.toBe(true);
      expect(mockClient.getInfo).toHaveBeenCalledTimes(1);
    });

    it('returns false when the node reports no info', async () => {
      (mockClient.getInfo as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.isHealthy()).resolves.toBe(false);
    });

    it('returns false (never throws) when the info call rejects', async () => {
      (mockClient.getInfo as jest.Mock).mockRejectedValueOnce(new Error('node unreachable'));

      await expect(service.isHealthy()).resolves.toBe(false);
    });
  });

  describe('getPayoutCompletionData()', () => {
    it('returns [true, negated fee] once the tx is mined (has blockhash and confirmations)', async () => {
      mockClient.getTx.mockResolvedValueOnce({
        txid: 'TX_HASH_01',
        blockhash: 'BLOCK_HASH_01',
        confirmations: 6,
        time: 0,
        amount: 0.5,
        fee: -0.001,
      });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([true, 0.001]);
      expect(mockClient.getTx).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('defaults the fee to 0 for a mined tx that carries no fee field', async () => {
      mockClient.getTx.mockResolvedValueOnce({
        txid: 'TX_HASH_01',
        blockhash: 'BLOCK_HASH_01',
        confirmations: 6,
        time: 0,
        amount: 0.5,
      });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result[0]).toBe(true);
      expect(result[1]).toBe(-0); // -(undefined ?? 0)
    });

    it('treats a tx with zero confirmations as not complete', async () => {
      mockClient.getTx.mockResolvedValueOnce({
        txid: 'TX_HASH_01',
        blockhash: 'BLOCK_HASH_01',
        confirmations: 0,
        time: 0,
        amount: 0.5,
        fee: -0.001,
      });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result[0]).toBe(false);
      expect(result[1]).toBe(0);
    });

    it('treats an unmined tx (no blockhash) as not complete', async () => {
      mockClient.getTx.mockResolvedValueOnce({ txid: 'TX_HASH_01', confirmations: 6, time: 0, amount: 0.5 });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result[0]).toBeUndefined();
      expect(result[1]).toBe(0);
    });

    it('treats a missing tx as not complete', async () => {
      mockClient.getTx.mockResolvedValueOnce(null);

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result[0]).toBeNull();
      expect(result[1]).toBe(0);
    });
  });

  describe('getCurrentFeeRate()', () => {
    it('delegates to the fee service', async () => {
      await expect(service.getCurrentFeeRate()).resolves.toBe(10);
      expect(mockFeeService.getSendFeeRate).toHaveBeenCalledTimes(1);
    });
  });
});
