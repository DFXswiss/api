import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

// Mock config
jest.mock('src/config/config', () => ({
  GetConfig: jest.fn(() => ({
    blockchain: {
      evm: {
        pimlicoApiKey: 'test-api-key',
      },
      ethereum: {
        ethGatewayUrl: 'https://eth.example.com',
        ethApiKey: 'test',
      },
      arbitrum: {
        arbitrumGatewayUrl: 'https://arb.example.com',
        arbitrumApiKey: 'test',
      },
    },
  })),
}));

import { PimlicoPaymasterService } from '../pimlico-paymaster.service';

describe('PimlicoPaymasterService', () => {
  let service: PimlicoPaymasterService;

  beforeEach(() => {
    service = new PimlicoPaymasterService();
  });

  describe('isPaymasterAvailable', () => {
    it('should return true for Ethereum when API key is configured', () => {
      expect(service.isPaymasterAvailable(Blockchain.ETHEREUM)).toBe(true);
    });

    it('should return true for Arbitrum when API key is configured', () => {
      expect(service.isPaymasterAvailable(Blockchain.ARBITRUM)).toBe(true);
    });

    it('should return false for unsupported blockchain', () => {
      expect(service.isPaymasterAvailable(Blockchain.BITCOIN)).toBe(false);
    });
  });

  describe('getBundlerUrl', () => {
    it('should return correct URL for Ethereum', () => {
      const url = service.getBundlerUrl(Blockchain.ETHEREUM);
      expect(url).toBe('https://api.pimlico.io/v2/1/rpc?apikey=test-api-key');
    });

    it('should return correct URL for Arbitrum', () => {
      const url = service.getBundlerUrl(Blockchain.ARBITRUM);
      expect(url).toBe('https://api.pimlico.io/v2/42161/rpc?apikey=test-api-key');
    });

    it('should return correct URL for Sepolia', () => {
      const url = service.getBundlerUrl(Blockchain.SEPOLIA);
      expect(url).toBe('https://api.pimlico.io/v2/11155111/rpc?apikey=test-api-key');
    });

    it('should return undefined for unsupported blockchain', () => {
      const url = service.getBundlerUrl(Blockchain.BITCOIN);
      expect(url).toBeUndefined();
    });
  });

  describe('getSupportedBlockchains', () => {
    it('should return list of supported blockchains', () => {
      const blockchains = service.getSupportedBlockchains();
      expect(blockchains).toContain(Blockchain.ETHEREUM);
      expect(blockchains).toContain(Blockchain.ARBITRUM);
      expect(blockchains).toContain(Blockchain.OPTIMISM);
      expect(blockchains).toContain(Blockchain.POLYGON);
      expect(blockchains).toContain(Blockchain.BASE);
      expect(blockchains).toContain(Blockchain.SEPOLIA);
    });

    it('should not contain unsupported blockchains', () => {
      const blockchains = service.getSupportedBlockchains();
      expect(blockchains).not.toContain(Blockchain.BITCOIN);
      expect(blockchains).not.toContain(Blockchain.LIGHTNING);
    });
  });
});
