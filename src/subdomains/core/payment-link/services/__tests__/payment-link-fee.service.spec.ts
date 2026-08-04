import { ConfigService, CronRole, Environment, GetConfig } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BlockchainRegistryService } from 'src/integration/blockchain/shared/services/blockchain-registry.service';
import { PayoutBitcoinService } from 'src/subdomains/supporting/payout/services/payout-bitcoin.service';
import { PayoutFiroService } from 'src/subdomains/supporting/payout/services/payout-firo.service';
import { PaymentLinkFeeService } from '../payment-link-fee.service';

/** Rebuilds the global `Config` from the current environment, the way the config spec does. */
function withEnv(vars: Record<string, string | undefined>): () => void {
  const previous = Object.keys(vars).map((key) => [key, process.env[key]] as const);

  for (const [key, value] of Object.entries(vars)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  new ConfigService(GetConfig());

  return () => {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
    new ConfigService(GetConfig());
  };
}

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

  // --- getMinFee() Tests --- //

  describe('getMinFee()', () => {
    let restore: () => void;

    afterEach(() => restore?.());

    it('should load on demand when the cache is empty', async () => {
      restore = withEnv({ ENVIRONMENT: Environment.DEV });

      await expect(service.getMinFee(Blockchain.BITCOIN)).resolves.toBe(4);
      expect(payoutBitcoinService.getRecommendedFeeRate).toHaveBeenCalledTimes(1);
    });

    it('should serve the second call from the cache the first one filled', async () => {
      restore = withEnv({ ENVIRONMENT: Environment.DEV });

      await service.getMinFee(Blockchain.BITCOIN);
      await expect(service.getMinFee(Blockchain.BITCOIN)).resolves.toBe(4);

      expect(payoutBitcoinService.getRecommendedFeeRate).toHaveBeenCalledTimes(1);
    });

    it('should start ONE load for concurrent callers of the same blockchain', async () => {
      restore = withEnv({ ENVIRONMENT: Environment.DEV });

      // The cache is written when the load resolves, so without the in-flight map each of these
      // would see the same empty entry and start its own call.
      const fees = await Promise.all([
        service.getMinFee(Blockchain.BITCOIN),
        service.getMinFee(Blockchain.BITCOIN),
        service.getMinFee(Blockchain.BITCOIN),
      ]);

      expect(fees).toEqual([4, 4, 4]);
      expect(payoutBitcoinService.getRecommendedFeeRate).toHaveBeenCalledTimes(1);
    });

    it('should let the next caller retry after a failed load instead of inheriting it', async () => {
      restore = withEnv({ ENVIRONMENT: Environment.DEV });
      payoutBitcoinService.getRecommendedFeeRate.mockRejectedValueOnce(new Error('node down'));

      await expect(service.getMinFee(Blockchain.BITCOIN)).resolves.toBeUndefined();
      await expect(service.getMinFee(Blockchain.BITCOIN)).resolves.toBe(4);

      expect(payoutBitcoinService.getRecommendedFeeRate).toHaveBeenCalledTimes(2);
    });

    it('should not reach out to any fee source on LOC', async () => {
      // There are no node connections locally, so the job returns early and never fills the cache.
      // Loading on demand here would run into a timeout on every request.
      restore = withEnv({ ENVIRONMENT: Environment.LOC });

      await expect(service.getMinFee(Blockchain.BITCOIN)).resolves.toBeUndefined();
      expect(payoutBitcoinService.getRecommendedFeeRate).not.toHaveBeenCalled();
    });
  });

  // --- onModuleInit() Tests --- //

  describe('onModuleInit()', () => {
    let restore: () => void;

    afterEach(() => restore?.());

    it('should NOT warm the cache in the worker process', () => {
      // The hook runs in every process regardless of CRON_ROLE; the scope on `updateFees` does not
      // reach it. Unguarded it would query every fee source to fill a map nothing there reads.
      restore = withEnv({ CRON_ROLE: CronRole.WORKER });
      const updateFees = jest.spyOn(service, 'updateFees').mockResolvedValue();

      service.onModuleInit();

      expect(updateFees).not.toHaveBeenCalled();
    });

    it.each([CronRole.ALL, CronRole.API])('should warm the cache where requests land (%s)', (role) => {
      restore = withEnv({ CRON_ROLE: role });
      const updateFees = jest.spyOn(service, 'updateFees').mockResolvedValue();

      service.onModuleInit();

      expect(updateFees).toHaveBeenCalledTimes(1);
    });
  });
});
