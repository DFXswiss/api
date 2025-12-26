import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { WalletAccount } from '../../domain/wallet-account';
import { Eip7702DelegationService } from '../eip7702-delegation.service';

// Mock viem
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)), // 20 gwei
  })),
  createWalletClient: jest.fn(() => ({
    signAuthorization: jest.fn().mockResolvedValue({
      chainId: 1,
      address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
      nonce: 0,
      r: '0x1234',
      s: '0x5678',
      v: 27,
    }),
    sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
  })),
  encodeFunctionData: jest.fn().mockReturnValue('0xa9059cbb000000000000000000000000'),
  encodeAbiParameters: jest.fn().mockReturnValue('0xencoded'),
  encodePacked: jest.fn().mockReturnValue('0xpacked'),
  parseAbi: jest.fn().mockReturnValue([]),
  http: jest.fn(),
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn((key) => ({
    address: '0x1234567890123456789012345678901234567890',
    source: key,
  })),
  signTypedData: jest.fn().mockResolvedValue('0xsignature'),
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
        delegationEnabled: true,
      },
      ethereum: {
        ethGatewayUrl: 'https://eth-mainnet.g.alchemy.com/v2',
        ethApiKey: 'test-api-key',
        ethWalletPrivateKey: '0x' + '1'.repeat(64),
      },
      arbitrum: {
        arbitrumGatewayUrl: 'https://arb-mainnet.g.alchemy.com/v2',
        arbitrumApiKey: 'test-api-key',
        arbitrumWalletPrivateKey: '0x' + '2'.repeat(64),
      },
      optimism: {
        optimismGatewayUrl: 'https://opt-mainnet.g.alchemy.com/v2',
        optimismApiKey: 'test-api-key',
        optimismWalletPrivateKey: '0x' + '3'.repeat(64),
      },
      polygon: {
        polygonGatewayUrl: 'https://polygon-mainnet.g.alchemy.com/v2',
        polygonApiKey: 'test-api-key',
        polygonWalletPrivateKey: '0x' + '4'.repeat(64),
      },
      base: {
        baseGatewayUrl: 'https://base-mainnet.g.alchemy.com/v2',
        baseApiKey: 'test-api-key',
        baseWalletPrivateKey: '0x' + '5'.repeat(64),
      },
      bsc: {
        bscGatewayUrl: 'https://bsc-mainnet.nodereal.io/v1',
        bscApiKey: 'test-api-key',
        bscWalletPrivateKey: '0x' + '6'.repeat(64),
      },
      gnosis: {
        gnosisGatewayUrl: 'https://gnosis-mainnet.g.alchemy.com/v2',
        gnosisApiKey: 'test-api-key',
        gnosisWalletPrivateKey: '0x' + '7'.repeat(64),
      },
      sepolia: {
        sepoliaGatewayUrl: 'https://eth-sepolia.g.alchemy.com/v2',
        sepoliaApiKey: 'test-api-key',
        sepoliaWalletPrivateKey: '0x' + '8'.repeat(64),
      },
    },
  })),
}));

// Mock EvmUtil
jest.mock('../../evm.util', () => ({
  EvmUtil: {
    createWallet: jest.fn(() => ({
      address: '0xDepositAddress123456789012345678901234',
      privateKey: '0x' + 'a'.repeat(64),
    })),
    toWeiAmount: jest.fn((amount, decimals) => BigInt(amount * 10 ** (decimals || 18))),
  },
}));

describe('Eip7702DelegationService', () => {
  let service: Eip7702DelegationService;

  const validDepositAccount: WalletAccount = {
    seed: 'test test test test test test test test test test test junk',
    index: 0,
  };

  const validRecipient = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78';
  const validTokenAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Eip7702DelegationService],
    }).compile();

    service = module.get<Eip7702DelegationService>(Eip7702DelegationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isDelegationSupported', () => {
    it('should return true for Ethereum when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.ETHEREUM)).toBe(true);
    });

    it('should return true for Arbitrum when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.ARBITRUM)).toBe(true);
    });

    it('should return true for Optimism when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.OPTIMISM)).toBe(true);
    });

    it('should return true for Polygon when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.POLYGON)).toBe(true);
    });

    it('should return true for Base when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.BASE)).toBe(true);
    });

    it('should return true for BSC when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.BINANCE_SMART_CHAIN)).toBe(true);
    });

    it('should return true for Gnosis when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.GNOSIS)).toBe(true);
    });

    it('should return true for Sepolia when delegation is enabled', () => {
      expect(service.isDelegationSupported(Blockchain.SEPOLIA)).toBe(true);
    });

    it('should return false for unsupported blockchains', () => {
      expect(service.isDelegationSupported(Blockchain.BITCOIN)).toBe(false);
      expect(service.isDelegationSupported(Blockchain.LIGHTNING)).toBe(false);
      expect(service.isDelegationSupported(Blockchain.MONERO)).toBe(false);
      expect(service.isDelegationSupported(Blockchain.SOLANA)).toBe(false);
      expect(service.isDelegationSupported(Blockchain.TRON)).toBe(false);
      expect(service.isDelegationSupported(Blockchain.CARDANO)).toBe(false);
    });
  });

  describe('transferTokenViaDelegation', () => {
    describe('Input Validation', () => {
      it('should throw error for zero amount', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 0),
        ).rejects.toThrow('Invalid transfer amount: 0');
      });

      it('should throw error for negative amount', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, -100),
        ).rejects.toThrow('Invalid transfer amount: -100');
      });

      it('should throw error for invalid recipient address - too short', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, '0x123', 100),
        ).rejects.toThrow('Invalid recipient address: 0x123');
      });

      it('should throw error for invalid recipient address - not hex', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, 'not-an-address', 100),
        ).rejects.toThrow('Invalid recipient address: not-an-address');
      });

      it('should throw error for missing recipient address', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(service.transferTokenViaDelegation(validDepositAccount, token, '', 100)).rejects.toThrow(
          'Invalid recipient address:',
        );
      });

      it('should throw error for invalid token contract address', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: '0xinvalid',
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100),
        ).rejects.toThrow('Invalid token contract address: 0xinvalid');
      });

      it('should throw error for missing token contract address', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: null,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100),
        ).rejects.toThrow('Invalid token contract address');
      });
    });

    describe('Chain Support', () => {
      it('should throw error for unsupported blockchain', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.BITCOIN,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100),
        ).rejects.toThrow('EIP-7702 delegation not supported for Bitcoin');
      });

      it('should throw error for Solana', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.SOLANA,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await expect(
          service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100),
        ).rejects.toThrow('EIP-7702 delegation not supported for Solana');
      });
    });

    describe('Successful Transfer', () => {
      it('should successfully transfer tokens on Ethereum', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
          name: 'USDC',
        });

        const txHash = await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(txHash).toBe('0xmocktxhash123456789');
      });

      it('should successfully transfer tokens on Arbitrum', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ARBITRUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
          name: 'USDC',
        });

        const txHash = await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 50);

        expect(txHash).toBe('0xmocktxhash123456789');
      });

      it('should successfully transfer tokens on Base', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.BASE,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 18,
          name: 'WETH',
        });

        const txHash = await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 0.5);

        expect(txHash).toBe('0xmocktxhash123456789');
      });

      it('should handle very small amounts', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 18,
          name: 'SHIB',
        });

        const txHash = await service.transferTokenViaDelegation(
          validDepositAccount,
          token,
          validRecipient,
          0.000001,
        );

        expect(txHash).toBe('0xmocktxhash123456789');
      });

      it('should handle large amounts', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
          name: 'USDC',
        });

        const txHash = await service.transferTokenViaDelegation(
          validDepositAccount,
          token,
          validRecipient,
          1000000,
        );

        expect(txHash).toBe('0xmocktxhash123456789');
      });
    });

    describe('Viem Integration', () => {
      it('should call createPublicClient with correct parameters', async () => {
        const { createPublicClient } = require('viem');
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(createPublicClient).toHaveBeenCalled();
      });

      it('should call createWalletClient with correct parameters', async () => {
        const { createWalletClient } = require('viem');
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(createWalletClient).toHaveBeenCalled();
      });

      it('should call encodeFunctionData for ERC20 transfer', async () => {
        const { encodeFunctionData } = require('viem');
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(encodeFunctionData).toHaveBeenCalledWith(
          expect.objectContaining({
            functionName: 'transfer',
          }),
        );
      });

      it('should call encodePacked for ERC-7579 execution data', async () => {
        const { encodePacked } = require('viem');
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(encodePacked).toHaveBeenCalledWith(['address', 'uint256', 'bytes'], expect.any(Array));
      });

      it('should sign delegation with EIP-712', async () => {
        const { signTypedData } = require('viem/accounts');
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(signTypedData).toHaveBeenCalledWith(
          expect.objectContaining({
            domain: expect.objectContaining({
              name: 'DelegationManager',
              version: '1',
            }),
            primaryType: 'Delegation',
          }),
        );
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle address with mixed case', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });
      const mixedCaseRecipient = '0x742D35Cc6634C0532925a3b844Bc9E7595f2bD78';

      const txHash = await service.transferTokenViaDelegation(
        validDepositAccount,
        token,
        mixedCaseRecipient,
        100,
      );

      expect(txHash).toBe('0xmocktxhash123456789');
    });

    it('should handle token with 0 decimals', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 0,
      });

      const txHash = await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(txHash).toBe('0xmocktxhash123456789');
    });

    it('should handle token with high decimals (18)', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 18,
      });

      const txHash = await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 1.5);

      expect(txHash).toBe('0xmocktxhash123456789');
    });

    it('should work with different deposit account indices', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });
      const accountWithIndex5: WalletAccount = {
        seed: 'test test test test test test test test test test test junk',
        index: 5,
      };

      const txHash = await service.transferTokenViaDelegation(accountWithIndex5, token, validRecipient, 100);

      expect(txHash).toBe('0xmocktxhash123456789');
    });
  });
});
