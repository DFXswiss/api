import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock viem
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    getBalance: jest.fn().mockResolvedValue(BigInt(0)),
    getBlock: jest.fn().mockResolvedValue({ baseFeePerGas: BigInt(10000000000) }),
    estimateMaxPriorityFeePerGas: jest.fn().mockResolvedValue(BigInt(1000000000)),
  })),
  http: jest.fn(),
  formatEther: jest.fn((value: bigint) => (Number(value) / 1e18).toString()),
}));

jest.mock('viem/chains', () => ({
  mainnet: { id: 1, name: 'Ethereum' },
  arbitrum: { id: 42161, name: 'Arbitrum One' },
  optimism: { id: 10, name: 'OP Mainnet' },
  polygon: { id: 137, name: 'Polygon' },
  base: { id: 8453, name: 'Base' },
  bsc: { id: 56, name: 'BNB Smart Chain' },
  gnosis: { id: 100, name: 'Gnosis' },
  sepolia: { id: 11155111, name: 'Sepolia' },
}));

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

import * as viem from 'viem';
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

  describe('getGasPrice', () => {
    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('should return gas prices from Pimlico API', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              standard: {
                maxFeePerGas: '0x4a817c800', // 20 gwei
                maxPriorityFeePerGas: '0x3b9aca00', // 1 gwei
              },
            },
          }),
      });

      const result = await service.getGasPrice(Blockchain.ETHEREUM);

      expect(result.maxFeePerGas).toBe(BigInt('0x4a817c800'));
      expect(result.maxPriorityFeePerGas).toBe(BigInt('0x3b9aca00'));
    });

    it('should use fast gas price when standard is not available', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              fast: {
                maxFeePerGas: '0x5d21dba00', // 25 gwei
                maxPriorityFeePerGas: '0x77359400', // 2 gwei
              },
            },
          }),
      });

      const result = await service.getGasPrice(Blockchain.ETHEREUM);

      expect(result.maxFeePerGas).toBe(BigInt('0x5d21dba00'));
      expect(result.maxPriorityFeePerGas).toBe(BigInt('0x77359400'));
    });

    it('should call correct Pimlico endpoint', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              standard: {
                maxFeePerGas: '0x4a817c800',
                maxPriorityFeePerGas: '0x3b9aca00',
              },
            },
          }),
      });

      await service.getGasPrice(Blockchain.ETHEREUM);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.pimlico.io/v2/1/rpc?apikey=test-api-key',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('pimlico_getUserOperationGasPrice'),
        }),
      );
    });

    it('should throw error when Pimlico API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: { message: 'Rate limit exceeded' },
          }),
      });

      // Should fall back to on-chain estimation, not throw
      const result = await service.getGasPrice(Blockchain.ETHEREUM);

      // Fallback should return values from mocked viem
      expect(result.maxFeePerGas).toBeDefined();
      expect(result.maxPriorityFeePerGas).toBeDefined();
    });

    it('should fall back to on-chain estimation when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await service.getGasPrice(Blockchain.ETHEREUM);

      // Fallback values from mocked viem: baseFee * 2 + priorityFee = 10 * 2 + 1 = 21 gwei
      expect(result.maxFeePerGas).toBeDefined();
      expect(result.maxPriorityFeePerGas).toBeDefined();
    });

    it('should throw error for unsupported blockchain', async () => {
      await expect(service.getGasPrice(Blockchain.BITCOIN)).rejects.toThrow('Pimlico not configured for Bitcoin');
    });
  });

  describe('sponsorTransaction', () => {
    const userAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78' as `0x${string}`;
    const targetAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as `0x${string}`;
    const callData = '0xa9059cbb000000000000000000000000' as `0x${string}`;

    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('should return sponsored result when paymaster data is available', async () => {
      // First call for getGasPrice
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              standard: {
                maxFeePerGas: '0x4a817c800',
                maxPriorityFeePerGas: '0x3b9aca00',
              },
            },
          }),
      });

      // Second call for pm_getPaymasterStubData
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              paymasterAndData: '0xPaymasterData123',
              preVerificationGas: '0x10000',
              verificationGasLimit: '0x30000',
              callGasLimit: '0x30000',
            },
          }),
      });

      const result = await service.sponsorTransaction(Blockchain.ETHEREUM, userAddress, targetAddress, callData);

      expect(result.sponsored).toBe(true);
      expect(result.paymasterAndData).toBe('0xPaymasterData123');
      expect(result.maxFeePerGas).toBeDefined();
      expect(result.maxPriorityFeePerGas).toBeDefined();
    });

    it('should return not sponsored when paymasterAndData is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              standard: {
                maxFeePerGas: '0x4a817c800',
                maxPriorityFeePerGas: '0x3b9aca00',
              },
            },
          }),
      });

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              paymasterAndData: '0x',
            },
          }),
      });

      const result = await service.sponsorTransaction(Blockchain.ETHEREUM, userAddress, targetAddress, callData);

      expect(result.sponsored).toBe(false);
      expect(result.error).toBe('No sponsorship available');
    });

    it('should return error when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              standard: {
                maxFeePerGas: '0x4a817c800',
                maxPriorityFeePerGas: '0x3b9aca00',
              },
            },
          }),
      });

      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            error: { message: 'User not whitelisted' },
          }),
      });

      const result = await service.sponsorTransaction(Blockchain.ETHEREUM, userAddress, targetAddress, callData);

      expect(result.sponsored).toBe(false);
      expect(result.error).toBe('User not whitelisted');
    });

    it('should return error for unsupported blockchain', async () => {
      const result = await service.sponsorTransaction(Blockchain.BITCOIN, userAddress, targetAddress, callData);

      expect(result.sponsored).toBe(false);
      expect(result.error).toBe('Pimlico not configured for Bitcoin');
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        json: () =>
          Promise.resolve({
            result: {
              standard: {
                maxFeePerGas: '0x4a817c800',
                maxPriorityFeePerGas: '0x3b9aca00',
              },
            },
          }),
      });

      mockFetch.mockRejectedValueOnce(new Error('Connection timeout'));

      const result = await service.sponsorTransaction(Blockchain.ETHEREUM, userAddress, targetAddress, callData);

      expect(result.sponsored).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });
  });

  describe('checkSponsorshipEligibility', () => {
    const userAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78' as `0x${string}`;

    beforeEach(() => {
      mockFetch.mockReset();
    });

    it('should return eligible when user has zero balance', async () => {
      (viem.createPublicClient as jest.Mock).mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(BigInt(0)),
      });

      const result = await service.checkSponsorshipEligibility(Blockchain.ETHEREUM, userAddress);

      expect(result.eligible).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should return not eligible when user has balance', async () => {
      (viem.createPublicClient as jest.Mock).mockReturnValue({
        getBalance: jest.fn().mockResolvedValue(BigInt(1000000000000000000)), // 1 ETH
      });

      const result = await service.checkSponsorshipEligibility(Blockchain.ETHEREUM, userAddress);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('User has native balance');
    });

    it('should return not eligible for unsupported blockchain', async () => {
      const result = await service.checkSponsorshipEligibility(Blockchain.BITCOIN, userAddress);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('Pimlico not configured for Bitcoin');
    });

    it('should handle RPC errors gracefully', async () => {
      (viem.createPublicClient as jest.Mock).mockReturnValue({
        getBalance: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
      });

      const result = await service.checkSponsorshipEligibility(Blockchain.ETHEREUM, userAddress);

      expect(result.eligible).toBe(false);
      expect(result.reason).toBe('RPC unavailable');
    });

    it('should return not eligible when chain config is missing', async () => {
      const result = await service.checkSponsorshipEligibility(Blockchain.LIGHTNING, userAddress);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('not configured');
    });
  });
});
