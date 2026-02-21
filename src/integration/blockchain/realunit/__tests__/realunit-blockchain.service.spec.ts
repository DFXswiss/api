import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from 'src/shared/services/http.service';
import { RealUnitBlockchainService } from '../realunit-blockchain.service';

jest.mock('src/config/config', () => ({
  GetConfig: jest.fn(() => ({
    blockchain: {
      realunit: {
        api: {
          url: 'https://mock-api.example.com',
          key: 'mock-api-key',
        },
      },
    },
  })),
}));

describe('RealUnitBlockchainService', () => {
  let service: RealUnitBlockchainService;
  let httpService: jest.Mocked<HttpService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealUnitBlockchainService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RealUnitBlockchainService>(RealUnitBlockchainService);
    httpService = module.get(HttpService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBrokerbotSellPrice', () => {
    beforeEach(() => {
      httpService.post.mockResolvedValue({
        priceInCHF: 100,
        priceInEUR: 92,
        availableShares: 1000,
      });
    });

    it('should calculate ZCHF amount in Wei with default 0.5% slippage', async () => {
      const result = await service.getBrokerbotSellPrice(10);

      // 100 CHF/share * 10 shares * (1 - 0.005) = 995 CHF
      // 995 * 1e18 = 995000000000000000000n
      expect(result.zchfAmountWei).toBe(BigInt('995000000000000000000'));
    });

    it('should calculate correctly for 1 share', async () => {
      const result = await service.getBrokerbotSellPrice(1);

      // 100 * 1 * 0.995 = 99.5 CHF
      // 99.5 * 1e18 = 99500000000000000000n
      expect(result.zchfAmountWei).toBe(BigInt('99500000000000000000'));
    });

    it('should accept custom slippage in basis points', async () => {
      const result = await service.getBrokerbotSellPrice(10, 100); // 1% slippage

      // 100 * 10 * (1 - 0.01) = 990 CHF
      // 990 * 1e18 = 990000000000000000000n
      expect(result.zchfAmountWei).toBe(BigInt('990000000000000000000'));
    });

    it('should handle zero slippage', async () => {
      const result = await service.getBrokerbotSellPrice(10, 0);

      // 100 * 10 * 1.0 = 1000 CHF
      // 1000 * 1e18 = 1000000000000000000000n
      expect(result.zchfAmountWei).toBe(BigInt('1000000000000000000000'));
    });

    it('should handle fractional prices', async () => {
      httpService.post.mockResolvedValue({
        priceInCHF: 123.45,
        priceInEUR: 114,
        availableShares: 500,
      });

      const result = await service.getBrokerbotSellPrice(5);

      // 123.45 * 5 * 0.995 = 614.16375
      // Math.floor(614.16375 * 1e18) = 614163750000000000000n
      const expected = BigInt(Math.floor(123.45 * 5 * 0.995 * 1e18));
      expect(result.zchfAmountWei).toBe(expected);
    });

    it('should use cached price (not call API twice)', async () => {
      await service.getBrokerbotSellPrice(10);
      await service.getBrokerbotSellPrice(5);

      // Only 1 API call because of 30s cache
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it('should floor the Wei amount (no fractional Wei)', async () => {
      httpService.post.mockResolvedValue({
        priceInCHF: 33.33,
        priceInEUR: 30,
        availableShares: 100,
      });

      const result = await service.getBrokerbotSellPrice(3);

      // Result should be a whole bigint (no decimals)
      expect(typeof result.zchfAmountWei).toBe('bigint');
      expect(result.zchfAmountWei).toBeGreaterThan(0n);
    });
  });

  describe('getBrokerbotInfo', () => {
    it('should return the passed addresses correctly', async () => {
      httpService.post.mockResolvedValue({ priceInCHF: 100, priceInEUR: 92, availableShares: 500 });

      const result = await service.getBrokerbotInfo('0xBrokerbot', '0xREALU', '0xZCHF');

      expect(result.brokerbotAddress).toBe('0xBrokerbot');
      expect(result.tokenAddress).toBe('0xREALU');
      expect(result.baseCurrencyAddress).toBe('0xZCHF');
    });

    it('should return price from fetchPrice', async () => {
      httpService.post.mockResolvedValue({ priceInCHF: 123.45, priceInEUR: 114, availableShares: 200 });

      const result = await service.getBrokerbotInfo('0xBB', '0xR', '0xZ');

      expect(result.pricePerShare).toBe('123.45');
      expect(result.availableShares).toBe(200);
    });

    it('should set buyingEnabled to false when availableShares is 0', async () => {
      httpService.post.mockResolvedValue({ priceInCHF: 100, priceInEUR: 92, availableShares: 0 });

      const result = await service.getBrokerbotInfo('0xBB', '0xR', '0xZ');

      expect(result.buyingEnabled).toBe(false);
    });

    it('should always set sellingEnabled to true', async () => {
      httpService.post.mockResolvedValue({ priceInCHF: 100, priceInEUR: 92, availableShares: 0 });

      const result = await service.getBrokerbotInfo('0xBB', '0xR', '0xZ');

      expect(result.sellingEnabled).toBe(true);
    });
  });
});
