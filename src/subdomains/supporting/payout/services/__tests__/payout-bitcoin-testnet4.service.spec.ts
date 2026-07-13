/**
 * Unit Tests for PayoutBitcoinTestnet4Service
 *
 * Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
 * BitcoinTestnet4Client means the on-chain send was reached (tx may be in-flight) and must
 * surface as PayoutBroadcastException so BitcoinBasedStrategy#send keeps the order
 * PAYOUT_DESIGNATED (fail-closed) instead of rolling back and risking a double-spend on retry.
 */

import { Config, ConfigService } from 'src/config/config';
import { BitcoinTestnet4Client } from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4-client';
import { BitcoinTestnet4Service } from 'src/integration/blockchain/bitcoin-testnet4/bitcoin-testnet4.service';
import { TxBroadcastError } from 'src/integration/blockchain/shared/errors/tx-broadcast.error';
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../exceptions/payout-broadcast.exception';
import { PayoutGroup } from '../base/payout-bitcoin-based.service';
import { PayoutBitcoinTestnet4Service } from '../payout-bitcoin-testnet4.service';

describe('PayoutBitcoinTestnet4Service', () => {
  let service: PayoutBitcoinTestnet4Service;
  let mockClient: jest.Mocked<BitcoinTestnet4Client>;
  let sendManySpy: jest.Mock;

  beforeAll(() => {
    // PayoutBitcoinTestnet4Service#getCurrentFeeRate reads the module-level `Config` singleton
    // directly (only populated by the real app bootstrap), so a plain unit test must set it.
    new ConfigService();
  });

  beforeEach(() => {
    sendManySpy = jest.fn().mockResolvedValue('TX_HASH_01');

    mockClient = {
      sendMany: sendManySpy,
      getInfo: jest.fn(),
      getTx: jest.fn(),
      estimateSmartFee: jest.fn().mockResolvedValue(5),
    } as unknown as jest.Mocked<BitcoinTestnet4Client>;

    const mockBitcoinTestnet4Service = {
      getDefaultClient: jest.fn().mockReturnValue(mockClient),
    } as unknown as jest.Mocked<BitcoinTestnet4Service>;

    service = new PayoutBitcoinTestnet4Service(mockBitcoinTestnet4Service);
  });

  describe('sendUtxoToMany()', () => {
    it('should propagate the tx id on success', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];

      const result = await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(result).toBe('TX_HASH_01');
    });

    it('should wrap a TxBroadcastError from the client into a PayoutBroadcastException, keeping message and cause', async () => {
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.5 }];
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
  });

  describe('isHealthy()', () => {
    it('returns true when the node reports info', async () => {
      (mockClient.getInfo as jest.Mock).mockResolvedValueOnce({ blocks: 1000 });

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
    it('returns [true, negated fee] once the tx is found', async () => {
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
    it('applies the min-tx-amount multiplier (1.5) to the estimated smart fee', async () => {
      mockClient.estimateSmartFee.mockResolvedValueOnce(5);

      await expect(service.getCurrentFeeRate()).resolves.toBe(7.5);
      expect(mockClient.estimateSmartFee).toHaveBeenCalledWith(1);
    });

    it('falls back to the minimum rate of 1 when the smart-fee estimate is null', async () => {
      mockClient.estimateSmartFee.mockResolvedValueOnce(null);

      await expect(service.getCurrentFeeRate()).resolves.toBe(1.5);
    });

    it('applies no multiplier when the min-tx-amount guard is disabled', async () => {
      const originalMinTxAmount = Config.blockchain.bitcoinTestnet4.minTxAmount;
      Config.blockchain.bitcoinTestnet4.minTxAmount = 0;

      try {
        mockClient.estimateSmartFee.mockResolvedValueOnce(5);

        await expect(service.getCurrentFeeRate()).resolves.toBe(5);
      } finally {
        Config.blockchain.bitcoinTestnet4.minTxAmount = originalMinTxAmount;
      }
    });
  });

  describe('with an unavailable default client', () => {
    let serviceWithoutClient: PayoutBitcoinTestnet4Service;

    beforeEach(() => {
      const mockServiceWithoutClient = {
        getDefaultClient: jest.fn().mockReturnValue(undefined),
      } as unknown as jest.Mocked<BitcoinTestnet4Service>;

      serviceWithoutClient = new PayoutBitcoinTestnet4Service(mockServiceWithoutClient);
    });

    it('isHealthy() returns false instead of throwing on the optional client', async () => {
      await expect(serviceWithoutClient.isHealthy()).resolves.toBe(false);
    });

    it('getCurrentFeeRate() falls back to the minimum rate when the client is missing', async () => {
      await expect(serviceWithoutClient.getCurrentFeeRate()).resolves.toBe(1.5);
    });
  });
});
