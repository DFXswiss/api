import { GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';

describe('PaymentLinkFeeService', () => {
  let service: PaymentLinkFeeService;
  let blockchainRegistryService: jest.Mocked<BlockchainRegistryService>;
  let payoutBitcoinService: jest.Mocked<PayoutBitcoinService>;

  beforeEach(() => {
    blockchainRegistryService = {} as unknown as jest.Mocked<BlockchainRegistryService>;

    payoutBitcoinService = {
      getCurrentFeeRate: jest.fn().mockResolvedValue(8),
      getRecommendedFeeRate: jest.fn().mockResolvedValue(4),
    } as unknown as jest.Mocked<PayoutBitcoinService>;

    service = new PaymentLinkFeeService(blockchainRegistryService, payoutBitcoinService);
  });

  // --- calculateFee() Tests --- //

  describe('calculateFee()', () => {
    it('should use the network relay floor (not a margin-multiplied rate) as the Firo customer minimum', async () => {
      const fee = await service['calculateFee'](Blockchain.FIRO);

      expect(fee).toBe(GetConfig().blockchain.firo.minFeeRate);
    });

    it('should keep the Firo minimum at or below the relay floor so protocol-fixed Spark payments pass', () => {
      // A valid Spark tx pays exactly Firo's minRelayTxFee (~1 sat/vB); the customer minimum must
      // never exceed it, or legitimate Spark payments get rejected again.
      expect(GetConfig().blockchain.firo.minFeeRate).toBeLessThanOrEqual(1);
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
