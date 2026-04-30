import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { PimlicoPaymasterService } from '../pimlico-paymaster.service';

// Mock config
jest.mock('src/config/config', () => ({
  GetConfig: jest.fn(() => ({
    blockchain: {
      evm: {
        pimlicoApiKey: 'test-pimlico-api-key',
      },
    },
  })),
}));

describe('PimlicoPaymasterService', () => {
  let service: PimlicoPaymasterService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PimlicoPaymasterService],
    }).compile();

    service = module.get<PimlicoPaymasterService>(PimlicoPaymasterService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isPaymasterAvailable', () => {
    it('should return true for supported blockchains when API key is configured', () => {
      expect(service.isPaymasterAvailable(Blockchain.ETHEREUM)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.ARBITRUM)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.OPTIMISM)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.POLYGON)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.BASE)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.BINANCE_SMART_CHAIN)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.GNOSIS)).toBe(true);
      expect(service.isPaymasterAvailable(Blockchain.SEPOLIA)).toBe(true);
    });

    it('should return false for unsupported blockchains', () => {
      expect(service.isPaymasterAvailable(Blockchain.BITCOIN)).toBe(false);
      expect(service.isPaymasterAvailable(Blockchain.LIGHTNING)).toBe(false);
      expect(service.isPaymasterAvailable(Blockchain.MONERO)).toBe(false);
      expect(service.isPaymasterAvailable(Blockchain.SOLANA)).toBe(false);
    });
  });

  describe('getBundlerUrl', () => {
    it('should return correct Pimlico bundler URL for Ethereum', () => {
      const url = service.getBundlerUrl(Blockchain.ETHEREUM);
      expect(url).toBe('https://api.pimlico.io/v2/ethereum/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for Arbitrum', () => {
      const url = service.getBundlerUrl(Blockchain.ARBITRUM);
      expect(url).toBe('https://api.pimlico.io/v2/arbitrum/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for Optimism', () => {
      const url = service.getBundlerUrl(Blockchain.OPTIMISM);
      expect(url).toBe('https://api.pimlico.io/v2/optimism/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for Polygon', () => {
      const url = service.getBundlerUrl(Blockchain.POLYGON);
      expect(url).toBe('https://api.pimlico.io/v2/polygon/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for Base', () => {
      const url = service.getBundlerUrl(Blockchain.BASE);
      expect(url).toBe('https://api.pimlico.io/v2/base/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for BSC', () => {
      const url = service.getBundlerUrl(Blockchain.BINANCE_SMART_CHAIN);
      expect(url).toBe('https://api.pimlico.io/v2/binance/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for Gnosis', () => {
      const url = service.getBundlerUrl(Blockchain.GNOSIS);
      expect(url).toBe('https://api.pimlico.io/v2/gnosis/rpc?apikey=test-pimlico-api-key');
    });

    it('should return correct Pimlico bundler URL for Sepolia', () => {
      const url = service.getBundlerUrl(Blockchain.SEPOLIA);
      expect(url).toBe('https://api.pimlico.io/v2/sepolia/rpc?apikey=test-pimlico-api-key');
    });

    it('should return undefined for unsupported blockchains', () => {
      expect(service.getBundlerUrl(Blockchain.BITCOIN)).toBeUndefined();
      expect(service.getBundlerUrl(Blockchain.LIGHTNING)).toBeUndefined();
      expect(service.getBundlerUrl(Blockchain.MONERO)).toBeUndefined();
    });
  });
});

describe('PimlicoPaymasterService (no API key)', () => {
  let service: PimlicoPaymasterService;

  beforeEach(async () => {
    // Override mock to return no API key
    jest.resetModules();
    jest.doMock('src/config/config', () => ({
      GetConfig: jest.fn(() => ({
        blockchain: {
          evm: {
            pimlicoApiKey: undefined,
          },
        },
      })),
    }));

    // Re-import the service with new mock
    const { PimlicoPaymasterService: ServiceClass } = await import('../pimlico-paymaster.service');

    const module: TestingModule = await Test.createTestingModule({
      providers: [ServiceClass],
    }).compile();

    service = module.get<PimlicoPaymasterService>(ServiceClass);
  });

  afterEach(() => {
    jest.resetModules();
  });

  it('should return false for all blockchains when API key is not configured', () => {
    expect(service.isPaymasterAvailable(Blockchain.ETHEREUM)).toBe(false);
    expect(service.isPaymasterAvailable(Blockchain.ARBITRUM)).toBe(false);
    expect(service.isPaymasterAvailable(Blockchain.BASE)).toBe(false);
  });

  it('should return undefined bundler URL when API key is not configured', () => {
    expect(service.getBundlerUrl(Blockchain.ETHEREUM)).toBeUndefined();
    expect(service.getBundlerUrl(Blockchain.ARBITRUM)).toBeUndefined();
  });
});
