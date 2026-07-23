import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { PayoutFiroService } from 'src/subdomains/supporting/payout/services/payout-firo.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';

describe('PaymentLinkFeeService', () => {
  let service: PaymentLinkFeeService;
  let blockchainRegistryService: jest.Mocked<BlockchainRegistryService>;
  let payoutBitcoinService: jest.Mocked<PayoutBitcoinService>;
  let payoutFiroService: jest.Mocked<PayoutFiroService>;

  beforeEach(() => {
    blockchainRegistryService = {} as unknown as jest.Mocked<BlockchainRegistryService>;

    payoutBitcoinService = {
      getCurrentFeeRate: jest.fn().mockResolvedValue(8),
      getRecommendedFeeRate: jest.fn().mockResolvedValue(4),
    } as unknown as jest.Mocked<PayoutBitcoinService>;

    payoutFiroService = {
      getCurrentFeeRate: jest.fn().mockResolvedValue(6),
      getRecommendedFeeRate: jest.fn().mockResolvedValue(3),
    } as unknown as jest.Mocked<PayoutFiroService>;

    service = new PaymentLinkFeeService(blockchainRegistryService, payoutBitcoinService, payoutFiroService);
  });

  // --- calculateFee() Tests --- //

  describe('calculateFee()', () => {
    it('should use the recommended rate (not the CPFP-multiplied payout rate) as the Firo customer minimum', async () => {
      const fee = await service['calculateFee'](Blockchain.FIRO);

      expect(fee).toBe(3);
      expect(payoutFiroService.getRecommendedFeeRate).toHaveBeenCalledTimes(1);
      expect(payoutFiroService.getCurrentFeeRate).not.toHaveBeenCalled();
    });

    it('should floor the Firo minimum at the relay minimum so protocol-fixed Spark payments pass', async () => {
      // On a quiet Firo node estimatesmartfee yields the relay floor (~1 sat/vB); the customer
      // minimum must never exceed what a Spark-spend to the transparent deposit address pays.
      payoutFiroService.getRecommendedFeeRate.mockResolvedValueOnce(0.4);

      const fee = await service['calculateFee'](Blockchain.FIRO);

      expect(fee).toBe(1);
    });

    it('should use the recommended rate (not the CPFP-multiplied payout rate) as the Bitcoin customer minimum', async () => {
      const fee = await service['calculateFee'](Blockchain.BITCOIN);

      expect(fee).toBe(4);
      expect(payoutBitcoinService.getRecommendedFeeRate).toHaveBeenCalledTimes(1);
      expect(payoutBitcoinService.getCurrentFeeRate).not.toHaveBeenCalled();
    });

    it('should floor the Bitcoin minimum at the relay minimum when the recommended rate dips below it', async () => {
      payoutBitcoinService.getRecommendedFeeRate.mockResolvedValueOnce(0.4);

      const fee = await service['calculateFee'](Blockchain.BITCOIN);

      expect(fee).toBe(1);
    });
  });
});
