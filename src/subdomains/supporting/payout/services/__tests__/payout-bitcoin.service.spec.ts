/**
 * Unit Tests for PayoutBitcoinService
 *
 * Cover amount sanitization, validation and defensive fee-rate rounding
 * that protect the BTC payout pipeline from Bitcoin Core's strict
 * ParseFixedPoint amount/fee_rate rejection ("Invalid amount", error -3).
 */

import { BitcoinClient } from 'src/integration/blockchain/bitcoin/node/bitcoin-client';
import { BitcoinFeeService } from 'src/integration/blockchain/bitcoin/services/bitcoin-fee.service';
import { BitcoinService } from 'src/integration/blockchain/bitcoin/services/bitcoin.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { InvalidPayoutAmountException } from '../../exceptions/invalid-payout-amount.exception';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutGroup } from '../base/payout-bitcoin-based.service';
import { PayoutBitcoinService } from '../payout-bitcoin.service';

describe('PayoutBitcoinService', () => {
  let service: PayoutBitcoinService;
  let mockClient: jest.Mocked<BitcoinClient>;
  let mockFeeService: jest.Mocked<BitcoinFeeService>;
  let sendManySpy: jest.Mock;

  beforeEach(() => {
    sendManySpy = jest.fn().mockResolvedValue('TX_HASH_01');

    mockClient = {
      sendMany: sendManySpy,
      getInfo: jest.fn(),
      getTx: jest.fn(),
    } as unknown as jest.Mocked<BitcoinClient>;

    const mockBitcoinService = {
      getDefaultClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<BitcoinService>;

    mockFeeService = {
      getSendFeeRate: jest.fn(),
    } as unknown as jest.Mocked<BitcoinFeeService>;

    service = new PayoutBitcoinService(mockBitcoinService, mockFeeService);
  });

  describe('sendUtxoToMany()', () => {
    it('should quantize amounts to 8 decimals (strip JS float artifacts)', async () => {
      // 1.000000003 has more than 8 decimal places and is observably distinct from 1
      // in IEEE 754 — Bitcoin Core would reject it as "Invalid amount". This is a
      // stronger probe than 0.1 + 0.2 because the un-rounded raw value cannot
      // collapse to the asserted post-round value by coincidence.
      const rawAmount = 1.000000003;
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: rawAmount }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(sendManySpy).toHaveBeenCalledTimes(1);
      const [calledPayout] = sendManySpy.mock.calls[0];
      expect(calledPayout[0].amount).toBe(1);
      expect(calledPayout[0].amount).not.toBe(rawAmount);
      // Verify the post-round value has at most 8 decimals (the Bitcoin Core ceiling).
      expect(Number.isInteger(calledPayout[0].amount * 1e8)).toBe(true);
    });

    it('should round fee rate to 3 decimals as defense-in-depth even if fee service regresses', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      // Simulate a value that slipped through the fee service un-rounded
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(3.8699999999999997);

      await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(sendManySpy).toHaveBeenCalledWith([{ addressTo: 'ADDR_01', amount: 0.5 }], 3.87);
    });

    it('should reject NaN amounts with structured error before RPC call', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_BAD', amount: NaN }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await expect(service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout)).rejects.toThrow(
        InvalidPayoutAmountException,
      );
      expect(sendManySpy).not.toHaveBeenCalled();
    });

    it('should reject zero amounts with structured error before RPC call', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_BAD', amount: 0 }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await expect(service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout)).rejects.toThrow(
        InvalidPayoutAmountException,
      );
      expect(sendManySpy).not.toHaveBeenCalled();
    });

    it('should reject negative amounts with structured error before RPC call', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_BAD', amount: -1 }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await expect(service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout)).rejects.toThrow(
        InvalidPayoutAmountException,
      );
      expect(sendManySpy).not.toHaveBeenCalled();
    });

    it('should reject infinite amounts with structured error before RPC call', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_BAD', amount: Infinity }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await expect(service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout)).rejects.toThrow(
        InvalidPayoutAmountException,
      );
      expect(sendManySpy).not.toHaveBeenCalled();
    });

    it('should sanitize every entry in a multi-recipient payout group', async () => {
      const payout: PayoutGroup = [
        { addressTo: 'ADDR_01', amount: 0.1 + 0.2 },
        { addressTo: 'ADDR_02', amount: 1.000000003 },
      ];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      const [calledPayout] = sendManySpy.mock.calls[0];
      expect(calledPayout).toEqual([
        { addressTo: 'ADDR_01', amount: 0.3 },
        { addressTo: 'ADDR_02', amount: 1 },
      ]);
    });

    it('should propagate the RPC tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      const result = await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(result).toBe('TX_HASH_01');
    });

    // Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
    // client means the on-chain send was reached (tx may be in-flight) and must surface as
    // PayoutBroadcastException so BitcoinBasedStrategy#send keeps the order PAYOUT_DESIGNATED
    // (fail-closed) instead of rolling back and risking a double-spend on retry.
    it('should wrap a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);
      const cause = new TxBroadcastError('Bitcoin RPC send failed: timeout');
      sendManySpy.mockRejectedValueOnce(cause);

      let error: unknown;
      try {
        await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(PayoutBroadcastException);
      expect((error as PayoutBroadcastException).message).toBe('Bitcoin RPC send failed: timeout');
      expect((error as PayoutBroadcastException).cause).toBe(cause);
    });

    it('should propagate a non-TxBroadcastError from the client unchanged', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);
      const plainError = new Error('unrelated client error');
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

    it('should propagate a pre-broadcast fee-rate timeout unchanged and never reach sendMany', async () => {
      // Fee estimation happens before sendMany is even called - a timeout here is provably
      // pre-broadcast and must self-heal (rollback), not fail-closed like a broadcast timeout.
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
      const timeoutError = new Error('RPC timeout during fee estimation');
      mockFeeService.getSendFeeRate.mockRejectedValueOnce(timeoutError);

      let error: unknown;
      try {
        await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);
      } catch (e) {
        error = e;
      }

      expect(error).toBe(timeoutError);
      expect(error).not.toBeInstanceOf(PayoutBroadcastException);
      expect(sendManySpy).not.toHaveBeenCalled();
    });
  });

  describe('isHealthy()', () => {
    it('returns true when the node reports info', async () => {
      (mockClient.getInfo as jest.Mock).mockResolvedValueOnce({ blocks: 800000 });

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
    it('returns [true, negated fee] once the tx is found (Bitcoin Core reports outgoing fees as negative)', async () => {
      mockClient.getTx.mockResolvedValueOnce({
        txid: 'TX_HASH_01',
        confirmations: 3,
        time: 0,
        amount: 0.5,
        fee: -0.0002,
      });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([true, 0.0002]);
      expect(mockClient.getTx).toHaveBeenCalledWith('TX_HASH_01');
    });

    it('defaults the fee to 0 for a found tx that carries no fee field', async () => {
      mockClient.getTx.mockResolvedValueOnce({ txid: 'TX_HASH_01', confirmations: 3, time: 0, amount: 0.5 });

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result[0]).toBe(true);
      expect(result[1]).toBe(-0); // -(undefined ?? 0)
    });

    it('returns [false, 0] while the tx is not yet in the wallet', async () => {
      mockClient.getTx.mockResolvedValueOnce(null);

      const result = await service.getPayoutCompletionData(PayoutOrderContext.BUY_CRYPTO, 'TX_HASH_01');

      expect(result).toEqual([false, 0]);
    });
  });

  describe('getCurrentFeeRate()', () => {
    it('delegates to the fee service', async () => {
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(7);

      await expect(service.getCurrentFeeRate()).resolves.toBe(7);
      expect(mockFeeService.getSendFeeRate).toHaveBeenCalledTimes(1);
    });
  });
});
