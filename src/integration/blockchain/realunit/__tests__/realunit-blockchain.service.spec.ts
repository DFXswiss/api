import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from 'src/shared/services/http.service';
import { RealUnitBlockchainService } from '../realunit-blockchain.service';

// Mock viem
const mockReadContract = jest.fn();
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    readContract: mockReadContract,
  })),
  http: jest.fn(),
  parseAbi: jest.fn((abi) => abi),
}));

jest.mock('viem/chains', () => ({
  sepolia: { id: 11155111, name: 'Sepolia' },
  mainnet: { id: 1, name: 'Ethereum' },
  arbitrum: { id: 42161, name: 'Arbitrum' },
  optimism: { id: 10, name: 'Optimism' },
  polygon: { id: 137, name: 'Polygon' },
  base: { id: 8453, name: 'Base' },
  bsc: { id: 56, name: 'BSC' },
  gnosis: { id: 100, name: 'Gnosis' },
}));

jest.mock('src/config/config', () => ({
  GetConfig: jest.fn(() => ({
    environment: 'loc',
    blockchain: {
      realunit: {
        api: {
          url: 'https://mock-api.example.com',
          key: 'mock-api-key',
        },
      },
      sepolia: {
        sepoliaChainId: 11155111,
        sepoliaGatewayUrl: 'https://sepolia.example.com',
        sepoliaApiKey: 'mock-key',
      },
      ethereum: {
        ethChainId: 1,
        ethGatewayUrl: 'https://mainnet.example.com',
        ethApiKey: 'mock-key',
      },
      arbitrum: { arbitrumChainId: 42161 },
      optimism: { optimismChainId: 10 },
      polygon: { polygonChainId: 137 },
      base: { baseChainId: 8453 },
      bsc: { bscChainId: 56 },
      gnosis: { gnosisChainId: 100 },
      citrea: { citreaChainId: 0 },
      citreaTestnet: { citreaTestnetChainId: 0 },
    },
  })),
  Config: jest.fn(),
  Environment: {
    DEV: 'dev',
    LOC: 'loc',
    STG: 'stg',
    PRD: 'prd',
  },
}));

describe('RealUnitBlockchainService', () => {
  let service: RealUnitBlockchainService;
  let httpService: jest.Mocked<HttpService>;

  const MOCK_BROKERBOT_ADDRESS = '0x39c33c2fd5b07b8e890fd2115d4adff7235fc9d2';

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
    it('should query BrokerBot contract and apply default 0.5% slippage', async () => {
      // BrokerBot returns 1000 ZCHF (in Wei) for 10 shares
      mockReadContract.mockResolvedValue(BigInt('1000000000000000000000'));

      const result = await service.getBrokerbotSellPrice(MOCK_BROKERBOT_ADDRESS, 10);

      // 1000 ZCHF * (1 - 0.005) = 995 ZCHF
      expect(result.zchfAmountWei).toBe(BigInt('995000000000000000000'));
    });

    it('should calculate correctly for 1 share', async () => {
      // BrokerBot returns 100 ZCHF for 1 share
      mockReadContract.mockResolvedValue(BigInt('100000000000000000000'));

      const result = await service.getBrokerbotSellPrice(MOCK_BROKERBOT_ADDRESS, 1);

      // 100 * 0.995 = 99.5 ZCHF
      expect(result.zchfAmountWei).toBe(BigInt('99500000000000000000'));
    });

    it('should accept custom slippage in basis points', async () => {
      // BrokerBot returns 1000 ZCHF for 10 shares
      mockReadContract.mockResolvedValue(BigInt('1000000000000000000000'));

      const result = await service.getBrokerbotSellPrice(MOCK_BROKERBOT_ADDRESS, 10, 100); // 1% slippage

      // 1000 * (1 - 0.01) = 990 ZCHF
      expect(result.zchfAmountWei).toBe(BigInt('990000000000000000000'));
    });

    it('should handle zero slippage', async () => {
      mockReadContract.mockResolvedValue(BigInt('1000000000000000000000'));

      const result = await service.getBrokerbotSellPrice(MOCK_BROKERBOT_ADDRESS, 10, 0);

      // Full amount with no slippage
      expect(result.zchfAmountWei).toBe(BigInt('1000000000000000000000'));
    });

    it('should call readContract with correct parameters', async () => {
      mockReadContract.mockResolvedValue(BigInt('100000000000000000000'));

      await service.getBrokerbotSellPrice(MOCK_BROKERBOT_ADDRESS, 5);

      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          address: MOCK_BROKERBOT_ADDRESS,
          functionName: 'getSellPrice',
          args: [BigInt(5)],
        }),
      );
    });
  });

  describe('getBrokerbotInfo', () => {
    beforeEach(() => {
      httpService.post.mockResolvedValue({ priceInCHF: 100, priceInEUR: 92, availableShares: 500 });
    });

    it('should return the passed addresses correctly', async () => {
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
