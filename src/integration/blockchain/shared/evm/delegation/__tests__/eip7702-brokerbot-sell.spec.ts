// Mock viem - must be before imports
jest.mock('viem', () => ({
  createPublicClient: jest.fn(() => ({
    getBlock: jest.fn().mockResolvedValue({ baseFeePerGas: BigInt(10000000000) }),
    estimateMaxPriorityFeePerGas: jest.fn().mockResolvedValue(BigInt(1000000000)),
    getTransactionCount: jest.fn().mockResolvedValue(BigInt(5)),
    getChainId: jest.fn().mockResolvedValue(11155111),
    getBalance: jest.fn().mockResolvedValue(0n),
  })),
  createWalletClient: jest.fn(() => ({
    signTransaction: jest.fn().mockResolvedValue('0xsignedtx'),
    sendRawTransaction: jest.fn().mockResolvedValue('0xbrokerbottxhash'),
  })),
  encodeFunctionData: jest.fn().mockImplementation(({ functionName }) => {
    if (functionName === 'transferAndCall') return '0xtransferAndCallData';
    if (functionName === 'transfer') return '0xtransferData';
    if (functionName === 'redeemDelegations') return '0xredeemData';
    return '0xunknown';
  }),
  encodeAbiParameters: jest.fn().mockReturnValue('0xpermissionContext'),
  encodePacked: jest.fn().mockImplementation((_types, [address]) => {
    if (address === '0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B') return '0xexecutionData1';
    if (address === '0xb58e61c3098d85632df34eecfb899a1eD80921CB') return '0xexecutionData2';
    return '0xpacked';
  }),
  parseAbi: jest.fn().mockReturnValue([]),
  http: jest.fn(),
}));

jest.mock('viem/accounts', () => ({
  privateKeyToAccount: jest.fn(() => ({
    address: '0x1234567890123456789012345678901234567890',
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

jest.mock('src/config/config', () => ({
  Config: { environment: 'loc' },
  Environment: { DEV: 'dev', LOC: 'loc', PRD: 'prd' },
  GetConfig: jest.fn(() => ({
    blockchain: {
      evm: { delegationEnabled: true },
      sepolia: {
        sepoliaGatewayUrl: 'https://eth-sepolia.g.alchemy.com/v2',
        sepoliaApiKey: 'test-api-key',
        sepoliaWalletPrivateKey: '0x' + '8'.repeat(64),
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
    },
  })),
}));

jest.mock('../../evm.util', () => ({
  EvmUtil: {
    toWeiAmount: jest.fn((amount, decimals) => BigInt(amount * 10 ** (decimals || 18))),
  },
}));

import { Test, TestingModule } from '@nestjs/testing';
import * as viem from 'viem';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { Eip7702DelegationService } from '../eip7702-delegation.service';

describe('Eip7702DelegationService - BrokerBot Sell', () => {
  let service: Eip7702DelegationService;

  const validUserAddress = '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD78';
  const validBrokerbotAddress = '0xCFF32C60B87296B8c0c12980De685bEd6Cb9dD6d';
  const validZchfAddress = '0xb58e61c3098d85632df34eecfb899a1eD80921CB';
  const validDfxDepositAddress = '0xAaBbCcDdEeFf00112233445566778899AaBbCcDd';

  const realuToken = createCustomAsset({
    blockchain: Blockchain.SEPOLIA,
    type: AssetType.TOKEN,
    chainId: '0x553C7f9C780316FC1D34b8e14ac2465Ab22a090B',
    decimals: 0,
    name: 'REALU',
  });

  const signedDelegation = {
    delegate: '0x1234567890123456789012345678901234567890',
    delegator: validUserAddress,
    authority: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    salt: '1234567890',
    signature: '0xmocksignature',
  };

  const authorization = {
    chainId: 11155111,
    address: '0x63c0c19a282a1b52b07dd5a65b58948a07dae32b',
    nonce: 0,
    r: '0x1234',
    s: '0x5678',
    yParity: 0,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [Eip7702DelegationService],
    }).compile();

    service = module.get<Eip7702DelegationService>(Eip7702DelegationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('isDelegationSupportedForRealUnit', () => {
    it('should return true for Sepolia in loc environment', () => {
      expect(service.isDelegationSupportedForRealUnit(Blockchain.SEPOLIA)).toBe(true);
    });

    it('should return false for Ethereum in loc environment', () => {
      expect(service.isDelegationSupportedForRealUnit(Blockchain.ETHEREUM)).toBe(false);
    });

    it('should return false for unsupported blockchains', () => {
      expect(service.isDelegationSupportedForRealUnit(Blockchain.BITCOIN)).toBe(false);
      expect(service.isDelegationSupportedForRealUnit(Blockchain.ARBITRUM)).toBe(false);
    });
  });

  describe('executeBrokerBotSellForRealUnit', () => {
    describe('Input Validation', () => {
      it('should throw for unsupported blockchain (Ethereum in loc env)', async () => {
        const ethToken = createCustomAsset({
          blockchain: Blockchain.ETHEREUM,
          type: AssetType.TOKEN,
          chainId: '0xRealuTokenAddress12345678901234567890',
          decimals: 0,
        });

        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            ethToken,
            validZchfAddress,
            validBrokerbotAddress,
            validDfxDepositAddress,
            10,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('EIP-7702 delegation not supported for RealUnit');
      });

      it('should throw for zero REALU amount', async () => {
        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            validZchfAddress,
            validBrokerbotAddress,
            validDfxDepositAddress,
            0,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('Invalid REALU amount: 0');
      });

      it('should throw for negative REALU amount', async () => {
        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            validZchfAddress,
            validBrokerbotAddress,
            validDfxDepositAddress,
            -5,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('Invalid REALU amount: -5');
      });

      it('should throw for invalid DFX deposit address', async () => {
        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            validZchfAddress,
            validBrokerbotAddress,
            '0xinvalid',
            10,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('Invalid DFX deposit address');
      });

      it('should throw for invalid BrokerBot address', async () => {
        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            validZchfAddress,
            '0xinvalid',
            validDfxDepositAddress,
            10,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('Invalid BrokerBot address');
      });

      it('should throw for invalid ZCHF address', async () => {
        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            '0xinvalid',
            validBrokerbotAddress,
            validDfxDepositAddress,
            10,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('Invalid ZCHF token address');
      });
    });

    describe('Batch Encoding', () => {
      it('should return a transaction hash on success', async () => {
        const txHash = await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        expect(txHash).toBe('0xbrokerbottxhash');
      });

      it('should encode transferAndCall for REALU -> BrokerBot (Call 1)', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        // Should call encodeFunctionData for transferAndCall
        expect(viem.encodeFunctionData).toHaveBeenCalledWith(
          expect.objectContaining({
            functionName: 'transferAndCall',
            args: [validBrokerbotAddress, expect.any(BigInt), '0x'],
          }),
        );
      });

      it('should encode ERC-20 transfer for ZCHF -> DFX deposit (Call 2)', async () => {
        const zchfAmountWei = BigInt('995000000000000000000');

        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          zchfAmountWei,
          signedDelegation,
          authorization,
        );

        // Should call encodeFunctionData for transfer
        expect(viem.encodeFunctionData).toHaveBeenCalledWith(
          expect.objectContaining({
            functionName: 'transfer',
            args: [validDfxDepositAddress, zchfAmountWei],
          }),
        );
      });

      it('should encode 2 execution datas via encodePacked', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        // Two encodePacked calls: one for REALU token, one for ZCHF token
        expect(viem.encodePacked).toHaveBeenCalledTimes(2);

        // Call 1: REALU token address
        expect(viem.encodePacked).toHaveBeenCalledWith(
          ['address', 'uint256', 'bytes'],
          [realuToken.chainId, 0n, '0xtransferAndCallData'],
        );

        // Call 2: ZCHF token address
        expect(viem.encodePacked).toHaveBeenCalledWith(
          ['address', 'uint256', 'bytes'],
          [validZchfAddress, 0n, '0xtransferData'],
        );
      });

      it('should call redeemDelegations with 2 permissionContexts and 2 executionDatas', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        // Find the redeemDelegations call
        const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
        const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');

        expect(redeemCall).toBeDefined();
        const [permissionContexts, modes, executionDatas] = redeemCall[0].args;

        // Must have exactly 2 entries each
        expect(permissionContexts).toHaveLength(2);
        expect(modes).toHaveLength(2);
        expect(executionDatas).toHaveLength(2);
      });

      it('should use same permissionContext for both calls', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
        const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');
        const [permissionContexts] = redeemCall[0].args;

        // Same delegation for both calls
        expect(permissionContexts[0]).toBe(permissionContexts[1]);
        expect(permissionContexts[0]).toBe('0xpermissionContext');
      });

      it('should use CALLTYPE_SINGLE for both calls', async () => {
        const CALLTYPE_SINGLE = '0x0000000000000000000000000000000000000000000000000000000000000000';

        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
        const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');
        const [, modes] = redeemCall[0].args;

        expect(modes[0]).toBe(CALLTYPE_SINGLE);
        expect(modes[1]).toBe(CALLTYPE_SINGLE);
      });

      it('should pass 2 different executionDatas (REALU + ZCHF)', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const calls = (viem.encodeFunctionData as jest.Mock).mock.calls;
        const redeemCall = calls.find((call) => call[0]?.functionName === 'redeemDelegations');
        const [, , executionDatas] = redeemCall[0].args;

        // executionData1 = REALU transferAndCall, executionData2 = ZCHF transfer
        expect(executionDatas[0]).toBe('0xexecutionData1');
        expect(executionDatas[1]).toBe('0xexecutionData2');
      });
    });

    describe('Transaction Construction', () => {
      it('should use gas limit of 500000n (higher than standard 200000n)', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const walletClient = (viem.createWalletClient as jest.Mock).mock.results[0].value;
        expect(walletClient.signTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            gas: 500000n,
          }),
        );
      });

      it('should include authorization in the transaction', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const walletClient = (viem.createWalletClient as jest.Mock).mock.results[0].value;
        expect(walletClient.signTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            authorizationList: [
              expect.objectContaining({
                address: authorization.address,
              }),
            ],
          }),
        );
      });

      it('should set transaction type to eip7702', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const walletClient = (viem.createWalletClient as jest.Mock).mock.results[0].value;
        expect(walletClient.signTransaction).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'eip7702',
            value: 0n,
          }),
        );
      });

      it('should sign and broadcast the transaction', async () => {
        await service.executeBrokerBotSellForRealUnit(
          validUserAddress,
          realuToken,
          validZchfAddress,
          validBrokerbotAddress,
          validDfxDepositAddress,
          10,
          BigInt('995000000000000000000'),
          signedDelegation,
          authorization,
        );

        const walletClient = (viem.createWalletClient as jest.Mock).mock.results[0].value;
        expect(walletClient.signTransaction).toHaveBeenCalled();
        expect(walletClient.sendRawTransaction).toHaveBeenCalledWith({
          serializedTransaction: '0xsignedtx',
        });
      });
    });

    describe('Error Propagation', () => {
      it('should propagate transaction broadcast errors', async () => {
        (viem.createWalletClient as jest.Mock).mockReturnValue({
          signTransaction: jest.fn().mockResolvedValue('0xsignedtx'),
          sendRawTransaction: jest.fn().mockRejectedValue(new Error('execution reverted')),
        });

        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            validZchfAddress,
            validBrokerbotAddress,
            validDfxDepositAddress,
            10,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('execution reverted');
      });

      it('should propagate RPC connection errors', async () => {
        (viem.createPublicClient as jest.Mock).mockReturnValue({
          getBlock: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
          estimateMaxPriorityFeePerGas: jest.fn().mockResolvedValue(BigInt(1000000000)),
          getTransactionCount: jest.fn().mockResolvedValue(BigInt(0)),
          getChainId: jest.fn().mockResolvedValue(11155111),
        });

        await expect(
          service.executeBrokerBotSellForRealUnit(
            validUserAddress,
            realuToken,
            validZchfAddress,
            validBrokerbotAddress,
            validDfxDepositAddress,
            10,
            BigInt('995000000000000000000'),
            signedDelegation,
            authorization,
          ),
        ).rejects.toThrow('ECONNREFUSED');
      });
    });
  });
});
