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
import { PayoutOrderContext } from '../../entities/payout-order.entity';
import { InvalidPayoutAmountException } from '../../exceptions/invalid-payout-amount.exception';
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
      // 0.1 + 0.2 = 0.30000000000000004 in JS — would be rejected by Bitcoin Core
      const payout: PayoutGroup = [{ addressTo: 'ADDR_01', amount: 0.1 + 0.2 }];
      mockFeeService.getSendFeeRate.mockResolvedValueOnce(5);

      await service.sendUtxoToMany(PayoutOrderContext.BUY_CRYPTO, payout);

      expect(sendManySpy).toHaveBeenCalledTimes(1);
      const [calledPayout] = sendManySpy.mock.calls[0];
      expect(calledPayout).toEqual([{ addressTo: 'ADDR_01', amount: 0.3 }]);
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
  });
});
