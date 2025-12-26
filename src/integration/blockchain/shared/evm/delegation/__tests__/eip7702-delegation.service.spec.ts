// Mock viem - must be before imports and use inline functions
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)), // 20 gwei
    estimateGas: jest.fn().mockResolvedValue(BigInt(200000)), // 200k gas estimate
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

import { Test, TestingModule } from '@nestjs/testing';
import * as viem from 'viem';
import * as viemAccounts from 'viem/accounts';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { WalletAccount } from '../../domain/wallet-account';
import { Eip7702DelegationService } from '../eip7702-delegation.service';

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
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(viem.createPublicClient).toHaveBeenCalled();
      });

      it('should call createWalletClient with correct parameters', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(viem.createWalletClient).toHaveBeenCalled();
      });

      it('should call encodeFunctionData for ERC20 transfer', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(viem.encodeFunctionData).toHaveBeenCalledWith(
          expect.objectContaining({
            functionName: 'transfer',
          }),
        );
      });

      it('should call encodePacked for ERC-7579 execution data', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(viem.encodePacked).toHaveBeenCalledWith(['address', 'uint256', 'bytes'], expect.any(Array));
      });

      it('should sign delegation with EIP-712', async () => {
        const token = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: validTokenAddress,
          decimals: 6,
        });

        await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

        expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
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

  describe('Delegation Struct Validation', () => {
    const ROOT_AUTHORITY = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const DELEGATION_MANAGER_ADDRESS = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';

    it('should create delegation with ROOT_AUTHORITY', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            authority: ROOT_AUTHORITY,
          }),
        }),
      );
    });

    it('should set delegate as relayer address (not deposit)', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      // Relayer account is created from privateKeyToAccount with the relayer private key
      // The mock returns address '0x1234567890123456789012345678901234567890'
      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            delegate: '0x1234567890123456789012345678901234567890',
          }),
        }),
      );
    });

    it('should set delegator as deposit address', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      // Deposit address is from EvmUtil.createWallet mock: '0xDepositAddress123456789012345678901234'
      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            delegator: '0xDepositAddress123456789012345678901234',
          }),
        }),
      );
    });

    it('should create delegation with empty caveats array', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            caveats: [],
          }),
        }),
      );
    });

    it('should create delegation with BigInt salt', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.objectContaining({
            salt: expect.any(BigInt),
          }),
        }),
      );
    });

    it('should use verifyingContract as DELEGATION_MANAGER_ADDRESS', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            verifyingContract: DELEGATION_MANAGER_ADDRESS,
          }),
        }),
      );
    });

    it('should include correct EIP-712 types for Delegation and Caveat', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          types: expect.objectContaining({
            Delegation: expect.arrayContaining([
              { name: 'delegate', type: 'address' },
              { name: 'delegator', type: 'address' },
              { name: 'authority', type: 'bytes32' },
              { name: 'caveats', type: 'Caveat[]' },
              { name: 'salt', type: 'uint256' },
            ]),
            Caveat: expect.arrayContaining([
              { name: 'enforcer', type: 'address' },
              { name: 'terms', type: 'bytes' },
            ]),
          }),
        }),
      );
    });
  });

  describe('Permission Context Encoding', () => {
    it('should encode permission context with correct tuple[] schema', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viem.encodeAbiParameters).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            type: 'tuple[]',
            components: expect.arrayContaining([
              expect.objectContaining({ name: 'delegate', type: 'address' }),
              expect.objectContaining({ name: 'delegator', type: 'address' }),
              expect.objectContaining({ name: 'authority', type: 'bytes32' }),
              expect.objectContaining({
                name: 'caveats',
                type: 'tuple[]',
                components: expect.arrayContaining([
                  expect.objectContaining({ name: 'enforcer', type: 'address' }),
                  expect.objectContaining({ name: 'terms', type: 'bytes' }),
                ]),
              }),
              expect.objectContaining({ name: 'salt', type: 'uint256' }),
              expect.objectContaining({ name: 'signature', type: 'bytes' }),
            ]),
          }),
        ],
        expect.any(Array),
      );
    });

    it('should include signature in encoded delegation', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      // The second argument to encodeAbiParameters should contain the delegation array
      // with signature field populated from signTypedData mock ('0xsignature')
      expect(viem.encodeAbiParameters).toHaveBeenCalledWith(
        expect.any(Array),
        [
          expect.arrayContaining([
            expect.objectContaining({
              signature: '0xsignature',
            }),
          ]),
        ],
      );
    });
  });

  describe('redeemDelegations Call', () => {
    const CALLTYPE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

    it('should call redeemDelegations with CALLTYPE_SINGLE mode', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      // Find the call to encodeFunctionData for redeemDelegations
      const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
      const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');

      expect(redeemCall).toBeDefined();
      expect(redeemCall[0].args[1]).toEqual([CALLTYPE_SINGLE]);
    });

    it('should pass arrays of equal length to redeemDelegations', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
      const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');

      expect(redeemCall).toBeDefined();
      const [permissionContexts, modes, executionCallDatas] = redeemCall[0].args;

      // All three arrays should have same length (1 for single delegation)
      expect(permissionContexts.length).toBe(1);
      expect(modes.length).toBe(1);
      expect(executionCallDatas.length).toBe(1);
    });

    it('should include encoded execution data from encodePacked', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
      const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');

      // executionCallDatas should contain the result from encodePacked ('0xpacked')
      expect(redeemCall[0].args[2]).toEqual(['0xpacked']);
    });

    it('should include encoded permission context from encodeAbiParameters', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
      const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');

      // permissionContexts should contain the result from encodeAbiParameters ('0xencoded')
      expect(redeemCall[0].args[0]).toEqual(['0xencoded']);
    });
  });

  describe('EIP-7702 Authorization', () => {
    const DELEGATOR_ADDRESS = '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b';
    const DELEGATION_MANAGER_ADDRESS = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';

    let mockWalletClient: { signAuthorization: jest.Mock; sendTransaction: jest.Mock };

    beforeEach(() => {
      // Reset publicClient mock with estimateGas
      (viem.createPublicClient as jest.Mock).mockReturnValue({
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: jest.fn().mockResolvedValue(BigInt(200000)),
      });

      mockWalletClient = {
        signAuthorization: jest.fn().mockResolvedValue({
          chainId: 1,
          address: DELEGATOR_ADDRESS,
          nonce: 0,
          r: '0x1234',
          s: '0x5678',
          v: 27,
        }),
        sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
      };
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);
    });

    it('should sign authorization for DELEGATOR_ADDRESS (MetaMask contract)', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(mockWalletClient.signAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({
          contractAddress: DELEGATOR_ADDRESS,
        }),
      );
    });

    it('should sign authorization with deposit account (not relayer)', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(mockWalletClient.signAuthorization).toHaveBeenCalledWith(
        expect.objectContaining({
          account: expect.objectContaining({
            // Deposit account private key starts with 'a' repeated (from EvmUtil mock)
            source: '0x' + 'a'.repeat(64),
          }),
        }),
      );
    });

    it('should include authorization in sendTransaction authorizationList', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          authorizationList: expect.arrayContaining([
            expect.objectContaining({
              address: DELEGATOR_ADDRESS,
            }),
          ]),
        }),
      );
    });

    it('should send transaction to DELEGATION_MANAGER_ADDRESS', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          to: DELEGATION_MANAGER_ADDRESS,
        }),
      );
    });
  });

  describe('ChainId Verification', () => {
    beforeEach(() => {
      // Reset mocks to default state
      (viem.createPublicClient as jest.Mock).mockReturnValue({
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: jest.fn().mockResolvedValue(BigInt(200000)),
      });
      (viem.createWalletClient as jest.Mock).mockReturnValue({
        signAuthorization: jest.fn().mockResolvedValue({
          chainId: 1,
          address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
          nonce: 0,
          r: '0x1234',
          s: '0x5678',
          v: 27,
        }),
        sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
      });
    });

    it('should use chainId 1 for Ethereum tokens', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: 1,
          }),
        }),
      );
    });

    it('should use chainId 42161 for Arbitrum tokens', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ARBITRUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: 42161,
          }),
        }),
      );
    });

    it('should use chainId 137 for Polygon tokens', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.POLYGON,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: 137,
          }),
        }),
      );
    });

    it('should use chainId 10 for Optimism tokens', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.OPTIMISM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: 10,
          }),
        }),
      );
    });

    it('should use chainId 8453 for Base tokens', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.BASE,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: 8453,
          }),
        }),
      );
    });

    it('should use chainId 56 for BSC tokens', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.BINANCE_SMART_CHAIN,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viemAccounts.signTypedData).toHaveBeenCalledWith(
        expect.objectContaining({
          domain: expect.objectContaining({
            chainId: 56,
          }),
        }),
      );
    });
  });

  describe('Error Handling', () => {
    // Helper to create default mocks for error tests
    const createDefaultMocks = () => {
      const mockPublicClient = {
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: jest.fn().mockResolvedValue(BigInt(200000)),
      };
      const mockWalletClient = {
        signAuthorization: jest.fn().mockResolvedValue({
          chainId: 1,
          address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
          nonce: 0,
          r: '0x1234',
          s: '0x5678',
          v: 27,
        }),
        sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
      };
      return { mockPublicClient, mockWalletClient };
    };

    it('should propagate transaction revert errors', async () => {
      const { mockPublicClient, mockWalletClient } = createDefaultMocks();
      mockWalletClient.sendTransaction.mockRejectedValue(new Error('execution reverted: InvalidDelegationSignature()'));
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'execution reverted: InvalidDelegationSignature()',
      );
    });

    it('should propagate gas estimation errors', async () => {
      const { mockPublicClient, mockWalletClient } = createDefaultMocks();
      mockPublicClient.getGasPrice.mockRejectedValue(new Error('Failed to estimate gas'));
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'Failed to estimate gas',
      );
    });

    it('should propagate RPC connection errors', async () => {
      const { mockPublicClient, mockWalletClient } = createDefaultMocks();
      mockPublicClient.getGasPrice.mockRejectedValue(new Error('ECONNREFUSED: Connection refused'));
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'ECONNREFUSED',
      );
    });

    it('should propagate authorization signing errors', async () => {
      const { mockPublicClient, mockWalletClient } = createDefaultMocks();
      mockWalletClient.signAuthorization.mockRejectedValue(new Error('User rejected the request'));
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'User rejected the request',
      );
    });

    it('should propagate nonce errors', async () => {
      const { mockPublicClient, mockWalletClient } = createDefaultMocks();
      mockWalletClient.sendTransaction.mockRejectedValue(new Error('nonce too low'));
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'nonce too low',
      );
    });

    it('should propagate insufficient funds errors', async () => {
      const { mockPublicClient, mockWalletClient } = createDefaultMocks();
      mockWalletClient.sendTransaction.mockRejectedValue(
        new Error('insufficient funds for gas * price + value: have 0, want 1000000'),
      );
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'insufficient funds',
      );
    });
  });

  describe('ERC-7579 Execution Data', () => {
    beforeEach(() => {
      // Reset mocks to default state after Error Handling tests
      (viem.createPublicClient as jest.Mock).mockReturnValue({
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: jest.fn().mockResolvedValue(BigInt(200000)),
      });
      (viem.createWalletClient as jest.Mock).mockReturnValue({
        signAuthorization: jest.fn().mockResolvedValue({
          chainId: 1,
          address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
          nonce: 0,
          r: '0x1234',
          s: '0x5678',
          v: 27,
        }),
        sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
      });
    });

    it('should encode execution data with token contract as target', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viem.encodePacked).toHaveBeenCalledWith(
        ['address', 'uint256', 'bytes'],
        [validTokenAddress, 0n, expect.any(String)],
      );
    });

    it('should encode execution data with zero value (no ETH transfer)', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(viem.encodePacked).toHaveBeenCalledWith(
        ['address', 'uint256', 'bytes'],
        [expect.any(String), 0n, expect.any(String)],
      );
    });

    it('should include ERC20 transfer calldata in execution data', async () => {
      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      // encodePacked should receive the result of encodeFunctionData for transfer
      expect(viem.encodePacked).toHaveBeenCalledWith(
        ['address', 'uint256', 'bytes'],
        [expect.any(String), expect.any(BigInt), '0xa9059cbb000000000000000000000000'],
      );
    });
  });

  describe('Dynamic Gas Estimation', () => {
    it('should call estimateGas with correct parameters', async () => {
      const mockEstimateGas = jest.fn().mockResolvedValue(BigInt(200000));
      const mockPublicClient = {
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: mockEstimateGas,
      };
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      expect(mockEstimateGas).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3', // DELEGATION_MANAGER_ADDRESS
          authorizationList: expect.any(Array),
        }),
      );
    });

    it('should apply 20% buffer to gas estimate', async () => {
      const baseEstimate = BigInt(200000);
      const mockPublicClient = {
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: jest.fn().mockResolvedValue(baseEstimate),
      };
      const mockWalletClient = {
        signAuthorization: jest.fn().mockResolvedValue({
          chainId: 1,
          address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
          nonce: 0,
          r: '0x1234',
          s: '0x5678',
          v: 27,
        }),
        sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
      };
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100);

      // 200000 * 120 / 100 = 240000
      const expectedGasLimit = (baseEstimate * 120n) / 100n;
      expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          gas: expectedGasLimit,
        }),
      );
    });

    it('should propagate estimateGas errors', async () => {
      const mockPublicClient = {
        getGasPrice: jest.fn().mockResolvedValue(BigInt(20000000000)),
        estimateGas: jest.fn().mockRejectedValue(new Error('execution reverted')),
      };
      const mockWalletClient = {
        signAuthorization: jest.fn().mockResolvedValue({
          chainId: 1,
          address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
          nonce: 0,
          r: '0x1234',
          s: '0x5678',
          v: 27,
        }),
        sendTransaction: jest.fn().mockResolvedValue('0xmocktxhash123456789'),
      };
      (viem.createPublicClient as jest.Mock).mockReturnValue(mockPublicClient);
      (viem.createWalletClient as jest.Mock).mockReturnValue(mockWalletClient);

      const token = createCustomAsset({
        blockchain: Blockchain.ETHEREUM,
        type: AssetType.TOKEN,
        chainId: validTokenAddress,
        decimals: 6,
      });

      await expect(service.transferTokenViaDelegation(validDepositAccount, token, validRecipient, 100)).rejects.toThrow(
        'execution reverted',
      );
    });
  });
});
