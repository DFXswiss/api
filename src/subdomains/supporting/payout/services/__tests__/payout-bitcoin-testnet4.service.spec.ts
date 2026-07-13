/**
 * Unit Tests for PayoutBitcoinTestnet4Service
 *
 * Mirrors PayoutCardanoService: a TxBroadcastError from the (shared, non-payout-specific)
 * BitcoinTestnet4Client means the on-chain send was reached (tx may be in-flight) and must
 * surface as PayoutBroadcastException so BitcoinBasedStrategy#send keeps the order
 * PAYOUT_DESIGNATED (fail-closed) instead of rolling back and risking a double-spend on retry.
 */

import { ConfigService } from 'src/config/config';
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
});
