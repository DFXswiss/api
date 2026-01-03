// Mock viem - must be before imports
jest.mock('viem', () => ({
  parseAbi: jest.fn().mockReturnValue([]),
  decodeFunctionData: jest.fn(),
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn((key) => ({
    address: '0xRelayerAddress1234567890123456789012345',
    source: key,
  })),
  signMessage: jest.fn().mockResolvedValue('0x' + 'a'.repeat(130)), // 65 bytes signature in hex
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

// Mock config - must mock before any imports
const mockBlockchainConfig = {
  evm: { delegationEnabled: true },
  ethereum: { ethChainId: 1, ethWalletPrivateKey: '0x' + '1'.repeat(64) },
  arbitrum: { arbitrumChainId: 42161, arbitrumWalletPrivateKey: '0x' + '2'.repeat(64) },
  optimism: { optimismChainId: 10, optimismWalletPrivateKey: '0x' + '3'.repeat(64) },
  polygon: { polygonChainId: 137, polygonWalletPrivateKey: '0x' + '4'.repeat(64) },
  base: { baseChainId: 8453, baseWalletPrivateKey: '0x' + '5'.repeat(64) },
  bsc: { bscChainId: 56, bscWalletPrivateKey: '0x' + '6'.repeat(64) },
  gnosis: { gnosisChainId: 100, gnosisWalletPrivateKey: '0x' + '7'.repeat(64) },
  sepolia: { sepoliaChainId: 11155111, sepoliaWalletPrivateKey: '0x' + '8'.repeat(64) },
  citreaTestnet: { citreaTestnetChainId: 5115 },
};

jest.mock('src/config/config', () => ({
  GetConfig: jest.fn(() => ({
    environment: 'loc',
    blockchain: mockBlockchainConfig,
  })),
  Config: {
    environment: 'loc',
    blockchain: mockBlockchainConfig,
  },
  Environment: {
    LOC: 'loc',
    DEV: 'dev',
    STG: 'stg',
    PRD: 'prd',
  },
}));

// Mock blockchain util to avoid config dependencies
jest.mock('src/integration/blockchain/shared/util/blockchain.util', () => ({
  EvmBlockchains: ['Ethereum', 'Arbitrum', 'Optimism', 'Polygon', 'Base', 'BinanceSmartChain', 'Gnosis', 'Sepolia'],
  TestBlockchains: [],
}));

// Mock DepositService and its dependencies
jest.mock('src/subdomains/supporting/address-pool/deposit/deposit.service', () => ({
  DepositService: jest.fn().mockImplementation(() => ({
    isValidDepositAddress: jest.fn(),
  })),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import * as viem from 'viem';
import { PaymasterService } from '../paymaster.service';
import { DepositService } from 'src/subdomains/supporting/address-pool/deposit/deposit.service';

describe('PaymasterService', () => {
  let service: PaymasterService;
  let depositService: jest.Mocked<DepositService>;

  const validDepositAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78';
  const invalidAddress = '0x1234567890123456789012345678901234567890';

  // ERC20 transfer calldata for 100 USDC to validDepositAddress
  const validTransferCalldata =
    '0xa9059cbb000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f2bd780000000000000000000000000000000000000000000000000000000005f5e100';

  beforeEach(async () => {
    // Reset mocks
    (viem.decodeFunctionData as jest.Mock).mockReturnValue({
      functionName: 'transfer',
      args: [validDepositAddress, BigInt(100000000)],
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymasterService,
        {
          provide: DepositService,
          useValue: {
            isValidDepositAddress: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PaymasterService>(PaymasterService);
    depositService = module.get(DepositService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleRpcRequest', () => {
    describe('pm_getPaymasterStubData', () => {
      it('should return stub data for valid deposit address', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(true);

        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(1, request);

        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(1);
        expect(response.error).toBeUndefined();
        expect(response.result).toHaveProperty('paymaster');
        expect(response.result).toHaveProperty('paymasterData', '0x');
        expect(response.result).toHaveProperty('paymasterVerificationGasLimit', '0x30000');
        expect(response.result).toHaveProperty('paymasterPostOpGasLimit', '0x10000');
        expect(response.result).toHaveProperty('isFinal', false);
      });

      it('should return error for invalid deposit address', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(false);

        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(1, request);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32000);
        expect(response.error?.message).toContain('Only transfers to DFX deposit addresses are sponsored');
      });
    });

    describe('pm_getPaymasterData', () => {
      it('should return signed paymaster data for valid deposit address', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(true);

        const request = {
          jsonrpc: '2.0' as const,
          id: 2,
          method: 'pm_getPaymasterData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(1, request);

        expect(response.jsonrpc).toBe('2.0');
        expect(response.id).toBe(2);
        expect(response.error).toBeUndefined();
        expect(response.result).toHaveProperty('paymaster');
        expect(response.result).toHaveProperty('paymasterData');
        expect(response.result.paymasterData).toMatch(/^0x/);
      });

      it('should return error for invalid deposit address', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(false);

        const request = {
          jsonrpc: '2.0' as const,
          id: 2,
          method: 'pm_getPaymasterData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(1, request);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32000);
      });
    });

    describe('Unknown method', () => {
      it('should return method not found error', async () => {
        const request = {
          jsonrpc: '2.0' as const,
          id: 3,
          method: 'unknown_method' as any,
          params: [],
        };

        const response = await service.handleRpcRequest(1, request);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32601);
        expect(response.error?.message).toContain('Method not found');
      });
    });

    describe('Chain validation', () => {
      it('should return error for unsupported chain', async () => {
        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(999999, request);

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32000);
        expect(response.error?.message).toContain('Unsupported chain');
      });

      it('should accept Ethereum mainnet (chainId 1)', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(true);

        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(1, request);

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
      });

      it('should accept Arbitrum (chainId 42161)', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(true);

        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(42161, request);

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
      });

      it('should accept Base (chainId 8453)', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(true);

        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(8453, request);

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
      });

      it('should accept Sepolia testnet (chainId 11155111)', async () => {
        depositService.isValidDepositAddress.mockResolvedValue(true);

        const request = {
          jsonrpc: '2.0' as const,
          id: 1,
          method: 'pm_getPaymasterStubData' as const,
          params: [
            { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
            '0xEntryPoint',
            {},
          ],
        };

        const response = await service.handleRpcRequest(11155111, request);

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
      });
    });
  });

  describe('extractTransferRecipient', () => {
    it('should extract recipient from ERC20 transfer calldata', async () => {
      depositService.isValidDepositAddress.mockResolvedValue(true);

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
          '0xEntryPoint',
          {},
        ],
      };

      await service.handleRpcRequest(1, request);

      expect(depositService.isValidDepositAddress).toHaveBeenCalledWith(validDepositAddress);
    });

    it('should return error when calldata cannot be decoded', async () => {
      (viem.decodeFunctionData as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid calldata');
      });

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: '0xinvalidcalldata' },
          '0xEntryPoint',
          {},
        ],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Could not decode transfer recipient');
    });

    it('should handle ERC-7579 execution data format', async () => {
      // First decode fails, then inner decode succeeds
      (viem.decodeFunctionData as jest.Mock)
        .mockImplementationOnce(() => {
          throw new Error('Not a direct transfer');
        })
        .mockImplementationOnce(() => ({
          functionName: 'transfer',
          args: [validDepositAddress, BigInt(100000000)],
        }));

      depositService.isValidDepositAddress.mockResolvedValue(true);

      // ERC-7579 format: address (20 bytes) + value (32 bytes) + callData
      const erc7579CallData =
        '0x' +
        'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' + // token address (20 bytes = 40 hex chars)
        '0000000000000000000000000000000000000000000000000000000000000000' + // value (32 bytes = 64 hex chars)
        'a9059cbb000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f2bd780000000000000000000000000000000000000000000000000000000005f5e100'; // transfer calldata

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: erc7579CallData },
          '0xEntryPoint',
          {},
        ],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.error).toBeUndefined();
      expect(depositService.isValidDepositAddress).toHaveBeenCalledWith(validDepositAddress);
    });
  });

  describe('Deposit address validation', () => {
    it('should call depositService.isValidDepositAddress', async () => {
      depositService.isValidDepositAddress.mockResolvedValue(true);

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
          '0xEntryPoint',
          {},
        ],
      };

      await service.handleRpcRequest(1, request);

      expect(depositService.isValidDepositAddress).toHaveBeenCalledTimes(1);
    });

    it('should reject transactions to non-DFX addresses', async () => {
      depositService.isValidDepositAddress.mockResolvedValue(false);

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
          '0xEntryPoint',
          {},
        ],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.error).toBeDefined();
      expect(response.error?.message).toContain('Only transfers to DFX deposit addresses are sponsored');
    });

    it('should accept transactions to valid DFX deposit addresses', async () => {
      depositService.isValidDepositAddress.mockResolvedValue(true);

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
          '0xEntryPoint',
          {},
        ],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.error).toBeUndefined();
      expect(response.result).toBeDefined();
    });
  });

  describe('Paymaster signature', () => {
    it('should generate paymaster data with validUntil and signature', async () => {
      depositService.isValidDepositAddress.mockResolvedValue(true);

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
          '0xEntryPoint',
          {},
        ],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.result.paymasterData).toMatch(/^0x[0-9a-f]+$/i);
      // Paymaster data should contain validUntil (12 hex chars) + validAfter (12 hex chars) + signature
      expect(response.result.paymasterData.length).toBeGreaterThan(26); // 0x + 12 + 12 = 26 min
    });
  });

  describe('Error handling', () => {
    it('should handle depositService errors gracefully', async () => {
      depositService.isValidDepositAddress.mockRejectedValue(new Error('Database connection error'));

      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'pm_getPaymasterStubData' as const,
        params: [
          { sender: '0xUser123', nonce: '0x0', callData: validTransferCalldata },
          '0xEntryPoint',
          {},
        ],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.error).toBeDefined();
      expect(response.error?.code).toBe(-32000);
    });

    it('should preserve request id in error response', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 42,
        method: 'unknown_method' as any,
        params: [],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.id).toBe(42);
    });

    it('should preserve jsonrpc version in error response', async () => {
      const request = {
        jsonrpc: '2.0' as const,
        id: 1,
        method: 'unknown_method' as any,
        params: [],
      };

      const response = await service.handleRpcRequest(1, request);

      expect(response.jsonrpc).toBe('2.0');
    });
  });
});
