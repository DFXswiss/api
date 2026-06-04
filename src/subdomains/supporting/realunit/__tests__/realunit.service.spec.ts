import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { BrokerbotCurrency } from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { FaucetRequestService } from 'src/subdomains/core/faucet-request/services/faucet-request.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { HttpService } from 'src/shared/services/http.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { RealUnitRegistrationState, RealUnitRegistrationStatus } from '../dto/realunit-registration.dto';
import { RealUnitTransferRequestStatus } from '../entities/realunit-transfer-request.entity';
import { RealUnitDevService } from '../realunit-dev.service';
import { RealUnitService } from '../realunit.service';
import { RealUnitTransferRequestRepository } from '../repositories/realunit-transfer-request.repository';

// Mutable so individual tests can exercise the W2W gas-wallet config branches (key unset / no 0x prefix /
// address unset). Reset in beforeEach to the funded defaults. jest.mock factories may only close over
// variables prefixed with `mock`.
// The default key is a valid 32-byte private key so the prepare flow can derive the gas-wallet address
// (ethers.Wallet(key).address) — the W2W delegation's `delegate` must equal that derived address.
const mockW2wGasWalletKeyDefault = '0x' + '1'.repeat(64);
// Address derived from mockW2wGasWalletKeyDefault via ethers.Wallet(key).address (delegate == redeemer).
const mockW2wGasWalletAddressDerived = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
let mockW2wGasWalletPrivateKey: string | undefined = mockW2wGasWalletKeyDefault;
let mockW2wGasWalletAddress: string | undefined = '0xW2wGasWalletAddress';

jest.mock('src/config/config', () => ({
  get Config() {
    return {
      environment: 'loc',
      prefixes: { realUnitTransferUidPrefix: 'RT' },
      blockchain: {
        realunit: {
          brokerbotAddress: '0xBrokerbotAddress',
          w2wGasWalletPrivateKey: mockW2wGasWalletPrivateKey,
          w2wGasWalletAddress: mockW2wGasWalletAddress,
          w2wGasLowBalanceThreshold: 0.05,
        },
      },
    };
  },
  Environment: {
    LOC: 'loc',
    DEV: 'dev',
    PRD: 'prd',
  },
  GetConfig: jest.fn(() => ({
    blockchain: {
      realunit: {
        brokerbotAddress: '0xBrokerbotAddress',
        graphUrl: 'https://mock-ponder.example.com',
        api: { url: 'https://mock-api.example.com', key: 'mock-key' },
      },
      ethereum: { ethChainId: 1 },
      sepolia: { sepoliaChainId: 11155111 },
      arbitrum: { arbitrumChainId: 42161 },
      optimism: { optimismChainId: 10 },
      polygon: { polygonChainId: 137 },
      base: { baseChainId: 8453 },
      gnosis: { gnosisChainId: 100 },
      bsc: { bscChainId: 56 },
      citrea: { citreaChainId: 4114 },
      citreaTestnet: { citreaTestnetChainId: 5115 },
    },
    payment: {
      fee: 0.01,
      defaultPaymentTimeout: 900,
    },
    formats: {
      address: /.*/,
      signature: /.*/,
      key: /.*/,
      ref: /.*/,
      bankUsage: /.*/,
      recommendationCode: /.*/,
      kycHash: /.*/,
      phone: /.*/,
      accountServiceRef: /.*/,
      number: /.*/,
      transactionUid: /.*/,
    },
  })),
}));

jest.mock('src/shared/services/dfx-logger', () => ({
  DfxLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock('src/shared/utils/util', () => ({
  Util: {
    createUid: jest.fn().mockReturnValue('MOCK-UID'),
    equalsIgnoreCase: (a?: string, b?: string) => a?.toLowerCase() === b?.toLowerCase(),
    isoDate: (date: Date) => date.toISOString().split('T')[0],
  },
}));

describe('RealUnitService', () => {
  let service: RealUnitService;
  let assetService: jest.Mocked<AssetService>;
  let blockchainService: jest.Mocked<RealUnitBlockchainService>;
  let eip7702DelegationService: jest.Mocked<Eip7702DelegationService>;
  let transactionRequestService: jest.Mocked<TransactionRequestService>;
  let sellService: jest.Mocked<SellService>;
  let userService: jest.Mocked<UserService>;
  let kycService: jest.Mocked<KycService>;
  let transferRequestRepo: jest.Mocked<RealUnitTransferRequestRepository>;
  let sepoliaClient: { getNativeCoinBalanceForAddress: jest.Mock };

  const realuAsset = createCustomAsset({
    id: 1,
    name: 'REALU',
    blockchain: Blockchain.SEPOLIA,
    type: AssetType.TOKEN,
    chainId: '0xRealuChainId',
    decimals: 0,
  });

  const zchfAsset = createCustomAsset({
    id: 2,
    name: 'ZCHF',
    blockchain: Blockchain.SEPOLIA,
    type: AssetType.TOKEN,
    chainId: '0xZchfChainId',
    decimals: 18,
  });

  beforeEach(async () => {
    sepoliaClient = { getNativeCoinBalanceForAddress: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealUnitService,
        { provide: AssetPricesService, useValue: {} },
        { provide: PricingService, useValue: {} },
        {
          provide: AssetService,
          useValue: {
            getAssetByQuery: jest.fn(),
          },
        },
        {
          provide: RealUnitBlockchainService,
          useValue: {
            getBrokerbotInfo: jest.fn(),
            getBrokerbotSellPrice: jest.fn(),
          },
        },
        { provide: UserDataService, useValue: {} },
        {
          provide: UserService,
          useValue: {
            getUserByAddress: jest.fn(),
          },
        },
        {
          provide: KycService,
          useValue: {
            createCustomKycStep: jest.fn(),
          },
        },
        { provide: CountryService, useValue: {} },
        { provide: LanguageService, useValue: {} },
        { provide: HttpService, useValue: {} },
        { provide: FiatService, useValue: {} },
        { provide: BuyService, useValue: {} },
        {
          provide: SellService,
          useValue: {
            getById: jest.fn(),
          },
        },
        {
          provide: Eip7702DelegationService,
          useValue: {
            executeBrokerBotSellForRealUnit: jest.fn(),
            prepareDelegationDataForRealUnit: jest.fn(),
            transferTokenWithUserDelegation: jest.fn(),
          },
        },
        {
          provide: TransactionRequestService,
          useValue: {
            getOrThrow: jest.fn(),
            complete: jest.fn(),
          },
        },
        { provide: TransactionService, useValue: {} },
        { provide: AccountMergeService, useValue: {} },
        { provide: RealUnitDevService, useValue: {} },
        { provide: SwissQRService, useValue: {} },
        { provide: FeeService, useValue: {} },
        { provide: FaucetRequestService, useValue: {} },
        { provide: EthereumService, useValue: {} },
        {
          provide: SepoliaService,
          useValue: {
            getDefaultClient: jest.fn().mockReturnValue(sepoliaClient),
          },
        },
        {
          provide: RealUnitTransferRequestRepository,
          useValue: {
            create: jest.fn((e) => e),
            save: jest.fn((e) => Promise.resolve({ id: 99, ...e })),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RealUnitService>(RealUnitService);
    assetService = module.get(AssetService);
    blockchainService = module.get(RealUnitBlockchainService);
    eip7702DelegationService = module.get(Eip7702DelegationService);
    transactionRequestService = module.get(TransactionRequestService);
    sellService = module.get(SellService);
    userService = module.get(UserService);
    kycService = module.get(KycService);
    transferRequestRepo = module.get(RealUnitTransferRequestRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBrokerbotInfo', () => {
    it('should call assetService.getAssetByQuery for REALU and ZCHF', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      blockchainService.getBrokerbotInfo.mockResolvedValue({
        brokerbotAddress: '0xBrokerbotAddress',
        tokenAddress: realuAsset.chainId,
        baseCurrencyAddress: zchfAsset.chainId,
        pricePerShare: 100,
        currency: BrokerbotCurrency.CHF,
        buyingEnabled: true,
        sellingEnabled: true,
        availableShares: 500,
      });

      await service.getBrokerbotInfo();

      expect(assetService.getAssetByQuery).toHaveBeenCalledTimes(2);
      expect(assetService.getAssetByQuery).toHaveBeenCalledWith({
        name: 'REALU',
        blockchain: Blockchain.SEPOLIA,
        type: AssetType.TOKEN,
      });
      expect(assetService.getAssetByQuery).toHaveBeenCalledWith({
        name: 'ZCHF',
        blockchain: Blockchain.SEPOLIA,
        type: AssetType.TOKEN,
      });
    });

    it('should pass config brokerbotAddress and asset chainIds to blockchainService', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      blockchainService.getBrokerbotInfo.mockResolvedValue({} as any);

      await service.getBrokerbotInfo();

      expect(blockchainService.getBrokerbotInfo).toHaveBeenCalledWith(
        '0xBrokerbotAddress',
        '0xRealuChainId',
        '0xZchfChainId',
        undefined,
      );
    });

    it('should pass currency parameter to blockchainService', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      blockchainService.getBrokerbotInfo.mockResolvedValue({} as any);

      await service.getBrokerbotInfo(BrokerbotCurrency.EUR);

      expect(blockchainService.getBrokerbotInfo).toHaveBeenCalledWith(
        '0xBrokerbotAddress',
        '0xRealuChainId',
        '0xZchfChainId',
        BrokerbotCurrency.EUR,
      );
    });

    it('should return the result from blockchainService', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      const expected = {
        brokerbotAddress: '0xBrokerbotAddress',
        tokenAddress: '0xRealuChainId',
        baseCurrencyAddress: '0xZchfChainId',
        pricePerShare: 100,
        currency: BrokerbotCurrency.CHF,
        buyingEnabled: true,
        sellingEnabled: true,
        availableShares: 500,
      };
      blockchainService.getBrokerbotInfo.mockResolvedValue(expected);

      const result = await service.getBrokerbotInfo();

      expect(result).toEqual(expected);
    });
  });

  describe('confirmSell', () => {
    const userAddress = '0xUserAddress';
    const depositAddress = '0xDepositAddress';
    const mockTxHash = '0x' + 'a'.repeat(64);

    const mockRequest = {
      id: 1,
      isComplete: false,
      isValid: true,
      amount: 10,
      routeId: 5,
      user: { id: 42, address: userAddress },
    };

    const mockSell = {
      id: 5,
      deposit: { address: depositAddress },
      user: { id: 42 },
    };

    const mockDelegation = {
      delegate: '0xRelayer',
      delegator: userAddress,
      authority: '0xAuthority',
      salt: '1',
      signature: '0xSig',
    };

    const mockAuthorization = {
      chainId: 11155111,
      address: '0xDelegatorContract',
      nonce: 0,
      r: '0xR',
      s: '0xS',
      yParity: 0,
    };

    it('should execute EIP-7702 flow and return txHash', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      sellService.getById.mockResolvedValue(mockSell as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      blockchainService.getBrokerbotSellPrice.mockResolvedValue({ zchfAmountWei: BigInt('995000000000000000000') });
      eip7702DelegationService.executeBrokerBotSellForRealUnit.mockResolvedValue(mockTxHash);

      const result = await service.confirmSell(42, 1, {
        eip7702: { delegation: mockDelegation as any, authorization: mockAuthorization as any },
      });

      expect(result.txHash).toBe(mockTxHash);
      expect(blockchainService.getBrokerbotSellPrice).toHaveBeenCalledWith('0xBrokerbotAddress', 10);
      expect(eip7702DelegationService.executeBrokerBotSellForRealUnit).toHaveBeenCalledWith(
        userAddress,
        realuAsset,
        '0xZchfChainId',
        '0xBrokerbotAddress',
        depositAddress,
        10,
        BigInt('995000000000000000000'),
        mockDelegation,
        mockAuthorization,
      );
      expect(transactionRequestService.complete).toHaveBeenCalledWith(1);
    });

    it('should accept manual txHash and mark complete', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      sellService.getById.mockResolvedValue(mockSell as any);
      assetService.getAssetByQuery.mockResolvedValue(realuAsset);

      const result = await service.confirmSell(42, 1, { txHash: mockTxHash });

      expect(result.txHash).toBe(mockTxHash);
      expect(transactionRequestService.complete).toHaveBeenCalledWith(1);
      expect(eip7702DelegationService.executeBrokerBotSellForRealUnit).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if request is already complete', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue({ ...mockRequest, isComplete: true } as any);

      await expect(service.confirmSell(42, 1, { txHash: mockTxHash })).rejects.toThrow(ConflictException);
    });

    it('should throw BadRequestException if request is not valid', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue({ ...mockRequest, isValid: false } as any);

      await expect(service.confirmSell(42, 1, { txHash: mockTxHash })).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if delegator does not match user address', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      sellService.getById.mockResolvedValue(mockSell as any);
      assetService.getAssetByQuery.mockResolvedValue(realuAsset);

      const wrongDelegation = { ...mockDelegation, delegator: '0xWrongAddress' };

      await expect(
        service.confirmSell(42, 1, {
          eip7702: { delegation: wrongDelegation as any, authorization: mockAuthorization as any },
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if neither eip7702 nor txHash is provided', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      sellService.getById.mockResolvedValue(mockSell as any);
      assetService.getAssetByQuery.mockResolvedValue(realuAsset);

      await expect(service.confirmSell(42, 1, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('W2W transfer', () => {
    const senderAddress = '0x1111111111111111111111111111111111111111';
    const recipientAddress = '0x2222222222222222222222222222222222222222';
    const realuContract = '0x3333333333333333333333333333333333333333';
    const zchfContract = '0x4444444444444444444444444444444444444444';
    const w2wTxHash = '0x' + 'b'.repeat(64);

    const transferRealuAsset = createCustomAsset({
      id: 1,
      name: 'REALU',
      blockchain: Blockchain.SEPOLIA,
      type: AssetType.TOKEN,
      chainId: realuContract,
      decimals: 0,
    });

    const transferZchfAsset = createCustomAsset({
      id: 2,
      name: 'ZCHF',
      blockchain: Blockchain.SEPOLIA,
      type: AssetType.TOKEN,
      chainId: zchfContract,
      decimals: 18,
    });

    const delegationData = {
      relayerAddress: '0xRelayer',
      delegationManagerAddress: '0xManager',
      delegatorAddress: '0xDelegator',
      userNonce: 0,
      domain: { name: 'DelegationManager', version: '1', chainId: 11155111, verifyingContract: '0xManager' },
      types: { Delegation: [], Caveat: [] },
      message: { delegate: '0xRelayer', delegator: senderAddress, authority: '0xRoot', caveats: [], salt: 1 },
    };

    function buildRegisteredUser(kycLevel: number): any {
      const step = {
        getResult: () => ({ walletAddress: senderAddress }),
        isFailed: false,
        isCanceled: false,
        isCompleted: true,
        result: 'non-empty',
      };
      return {
        id: 42,
        address: senderAddress,
        userData: {
          kycLevel,
          getStepsWith: jest.fn().mockReturnValue([step]),
        },
      };
    }

    function mockTransferAssets(): void {
      assetService.getAssetByQuery.mockImplementation(async (q: any) =>
        q.name === 'REALU' ? transferRealuAsset : transferZchfAsset,
      );
    }

    beforeEach(() => {
      // reset mutable W2W gas-wallet config to the funded defaults
      mockW2wGasWalletPrivateKey = mockW2wGasWalletKeyDefault;
      mockW2wGasWalletAddress = '0xW2wGasWalletAddress';
    });

    describe('prepareTransfer', () => {
      it('returns delegation data and persists the request with correct to/amount', async () => {
        mockTransferAssets();
        sepoliaClient.getNativeCoinBalanceForAddress.mockResolvedValue(1); // funded
        eip7702DelegationService.prepareDelegationDataForRealUnit.mockResolvedValue(delegationData as any);

        const user = buildRegisteredUser(30);
        const result = await service.prepareTransfer(user, { toAddress: recipientAddress, amount: 5 });

        expect(eip7702DelegationService.prepareDelegationDataForRealUnit).toHaveBeenCalledWith(
          senderAddress,
          Blockchain.SEPOLIA,
          mockW2wGasWalletAddressDerived,
        );
        expect(transferRequestRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({
            toAddress: recipientAddress,
            amount: 5,
            status: RealUnitTransferRequestStatus.CREATED,
          }),
        );
        expect(result.toAddress).toBe(recipientAddress);
        expect(result.amount).toBe(5);
        expect(result.eip7702.recipient).toBe(recipientAddress);
        expect(result.eip7702.amountWei).toBe('5');
      });

      // Regression guard for the on-chain InvalidDelegate() revert (Sepolia tx that reverted because the
      // prepared delegate was the Sell/OTC relayer, not the W2W gas wallet that relays at confirm).
      // The delegation's `delegate` (== msg.sender of redeemDelegations) MUST be the W2W gas wallet
      // address derived from the SAME private key confirmTransfer relays with — never getRelayerPrivateKey.
      it('sets the delegation delegate to the W2W gas wallet (delegate == redeemer), not the Sell relayer', async () => {
        mockTransferAssets();
        sepoliaClient.getNativeCoinBalanceForAddress.mockResolvedValue(1); // funded

        // Echo the delegate override the service passes back into the prepared delegation message, exactly
        // as the real prepareDelegationDataForRealUnit does, so we can assert delegate == W2W wallet.
        eip7702DelegationService.prepareDelegationDataForRealUnit.mockImplementation(
          async (_user: string, _chain: Blockchain, delegateAddressOverride?: string) =>
            ({
              ...delegationData,
              relayerAddress: delegateAddressOverride,
              message: { ...delegationData.message, delegate: delegateAddressOverride },
            }) as any,
        );

        const user = buildRegisteredUser(30);
        const result = await service.prepareTransfer(user, { toAddress: recipientAddress, amount: 5 });

        // delegate / relayerAddress equal the address derived from the W2W gas wallet private key
        expect(result.eip7702.relayerAddress).toBe(mockW2wGasWalletAddressDerived);
        expect(result.eip7702.message.delegate).toBe(mockW2wGasWalletAddressDerived);
        // and NOT the Sell/OTC relayer placeholder ('0xRelayer') the old code would have embedded
        expect(result.eip7702.message.delegate).not.toBe('0xRelayer');
      });

      it('throws when registration is missing', async () => {
        const user: any = {
          id: 42,
          address: senderAddress,
          userData: { kycLevel: 30, getStepsWith: jest.fn().mockReturnValue([]) },
        };

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toBeDefined();
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('throws when KYC level is below 30', async () => {
        const user = buildRegisteredUser(20);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toBeDefined();
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('rejects an invalid recipient address', async () => {
        mockTransferAssets();
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: 'not-an-address', amount: 1 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('rejects sender == recipient', async () => {
        mockTransferAssets();
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: senderAddress, amount: 1 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('rejects the REALU token contract as recipient', async () => {
        mockTransferAssets();
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: realuContract, amount: 1 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('rejects a non-integer amount', async () => {
        mockTransferAssets();
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1.5 })).rejects.toThrow(
          BadRequestException,
        );
      });

      it('throws ServiceUnavailable when the W2W gas wallet balance is below threshold', async () => {
        mockTransferAssets();
        sepoliaClient.getNativeCoinBalanceForAddress.mockResolvedValue(0.001); // below 0.05 threshold
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('throws NotFound when the REALU asset is not found', async () => {
        assetService.getAssetByQuery.mockImplementation(async (q: any) =>
          q.name === 'REALU' ? undefined : transferZchfAsset,
        );
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toThrow(
          NotFoundException,
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('throws ServiceUnavailable when the W2W gas wallet private key is not configured', async () => {
        mockTransferAssets();
        mockW2wGasWalletPrivateKey = undefined;
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('throws ServiceUnavailable when the W2W gas wallet address is not configured', async () => {
        mockTransferAssets();
        mockW2wGasWalletAddress = undefined;
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toThrow(
          ServiceUnavailableException,
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });
    });

    describe('confirmTransfer', () => {
      const confirmDto: any = {
        delegation: {
          delegator: senderAddress,
          delegate: '0xRelayer',
          authority: '0xRoot',
          salt: '1',
          signature: '0xSig',
        },
        authorization: { chainId: 11155111, address: '0xDelegator', nonce: 0, r: '0xR', s: '0xS', yParity: 0 },
      };

      function buildStoredRequest(overrides: any = {}): any {
        return {
          id: 99,
          uid: 'RTabc',
          toAddress: recipientAddress,
          amount: 5,
          status: RealUnitTransferRequestStatus.CREATED,
          isComplete: false,
          user: { id: 42, address: senderAddress, userData: {} },
          complete: jest.fn(function (this: any, txHash: string) {
            this.status = RealUnitTransferRequestStatus.COMPLETED;
            this.txHash = txHash;
            return this;
          }),
          ...overrides,
        };
      }

      it('relays the stored recipient/amount via the dedicated W2W key (NOT getRelayerPrivateKey)', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        eip7702DelegationService.transferTokenWithUserDelegation.mockResolvedValue(w2wTxHash);

        const result = await service.confirmTransfer(42, 99, confirmDto);

        expect(result.txHash).toBe(w2wTxHash);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).toHaveBeenCalledWith(
          senderAddress,
          transferRealuAsset,
          recipientAddress, // STORED recipient, not from client
          5, // STORED amount, not from client
          confirmDto.delegation,
          confirmDto.authorization,
          mockW2wGasWalletKeyDefault, // dedicated W2W relayer key override
        );
      });

      it('throws NotFound when the request belongs to another user', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest({ user: { id: 7, address: senderAddress } }));

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(NotFoundException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws NotFound when the request does not exist', async () => {
        transferRequestRepo.findOne.mockResolvedValue(null as any);

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(NotFoundException);
      });

      it('throws Conflict when the request is already completed', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest({ isComplete: true }));
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(ConflictException);
      });

      it('throws BadRequest when the delegator does not match the request owner', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);

        const wrongDto = { ...confirmDto, delegation: { ...confirmDto.delegation, delegator: '0xWrong' } };

        await expect(service.confirmTransfer(42, 99, wrongDto)).rejects.toThrow(BadRequestException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws NotFound when the REALU asset is not found', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(undefined as any);

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(NotFoundException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws ServiceUnavailable when the W2W gas wallet private key is not configured', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        mockW2wGasWalletPrivateKey = undefined;

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(ServiceUnavailableException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('prefixes a bare (non-0x) W2W gas wallet private key before relaying', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        mockW2wGasWalletPrivateKey = '1'.repeat(64); // no 0x prefix -> exercises the `0x${...}` branch
        eip7702DelegationService.transferTokenWithUserDelegation.mockResolvedValue(w2wTxHash);

        await service.confirmTransfer(42, 99, confirmDto);

        expect(eip7702DelegationService.transferTokenWithUserDelegation).toHaveBeenCalledWith(
          senderAddress,
          transferRealuAsset,
          recipientAddress,
          5,
          confirmDto.delegation,
          confirmDto.authorization,
          '0x' + '1'.repeat(64), // 0x-normalized key
        );
      });
    });
  });

  describe('completeRegistrationForWalletAddress (idempotency)', () => {
    const walletAddress = '0x1111111111111111111111111111111111111111';
    const userDataId = 42;
    const matchingSignature = '0xSIGNATURE_MATCHING';
    const registrationDate = '2026-05-21';

    function buildExistingStep(opts: { signature: string; isCompleted: boolean }): any {
      return {
        getResult: () => ({
          signature: opts.signature,
          walletAddress,
          registrationDate,
        }),
        isCompleted: opts.isCompleted,
        isFailed: false,
        isCanceled: false,
        result: 'non-empty',
      };
    }

    function mockUserWithSteps(steps: any[]): void {
      const userData = {
        id: userDataId,
        getStepsWith: jest.fn().mockReturnValue(steps),
      };
      userService.getUserByAddress.mockResolvedValue({ userData } as any);
    }

    const dto = {
      walletAddress,
      signature: matchingSignature,
      registrationDate,
    };

    it('returns ALREADY_REGISTERED without creating a new KycStep when signature matches a completed registration', async () => {
      const existingStep = buildExistingStep({ signature: matchingSignature, isCompleted: true });
      mockUserWithSteps([existingStep]);

      const status = await service.completeRegistrationForWalletAddress(userDataId, dto);

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
      expect(kycService.createCustomKycStep).not.toHaveBeenCalled();
    });

    it('returns FORWARDING_FAILED when signature matches but the existing registration is not completed', async () => {
      const existingStep = buildExistingStep({ signature: matchingSignature, isCompleted: false });
      mockUserWithSteps([existingStep]);

      const status = await service.completeRegistrationForWalletAddress(userDataId, dto);

      expect(status).toBe(RealUnitRegistrationStatus.FORWARDING_FAILED);
      expect(kycService.createCustomKycStep).not.toHaveBeenCalled();
    });

    it('matches signatures case-insensitively (stored upper-case, incoming lower-case)', async () => {
      const existingStep = buildExistingStep({ signature: matchingSignature.toUpperCase(), isCompleted: true });
      mockUserWithSteps([existingStep]);

      const status = await service.completeRegistrationForWalletAddress(userDataId, {
        ...dto,
        signature: matchingSignature.toLowerCase(),
      });

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
      expect(kycService.createCustomKycStep).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when an existing registration for the same wallet has a different signature', async () => {
      const existingStep = buildExistingStep({ signature: '0xDIFFERENT_SIGNATURE', isCompleted: true });
      mockUserWithSteps([existingStep]);

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(BadRequestException);
      expect(kycService.createCustomKycStep).not.toHaveBeenCalled();
    });
  });

  describe('getRegistrationInfo', () => {
    const walletAddress = '0x2222222222222222222222222222222222222222';
    const otherWalletAddress = '0x3333333333333333333333333333333333333333';

    function buildVerifiedUserData(): any {
      return {
        firstname: 'Max',
        surname: 'Mustermann',
        mail: 'max@example.com',
        phone: '+41791234567',
        birthday: new Date('1990-05-21T00:00:00.000Z'),
        nationality: { id: 1, symbol: 'CH' },
        country: { id: 1, symbol: 'CH' },
        street: 'Bahnhofstrasse',
        houseNumber: '1',
        location: 'Zürich',
        zip: '8001',
        language: { symbol: 'DE' },
        accountType: 'Personal',
        tin: null,
        organizationName: null,
        organizationStreet: null,
        organizationHouseNumber: null,
        organizationLocation: null,
        organizationZip: null,
        organizationCountry: null,
        get naturalPersonName() {
          return [this.firstname, this.surname].filter((n) => n).join(' ');
        },
        getStepsWith: jest.fn().mockReturnValue([]),
      };
    }

    function buildStepForWallet(stepWalletAddress: string, opts: { isCompleted?: boolean } = {}): any {
      return {
        getResult: () => ({
          email: 'signed@example.com',
          name: 'Signed Name',
          type: 'HUMAN',
          phoneNumber: '+41790000000',
          birthday: '1990-01-01',
          nationality: 'CH',
          addressStreet: 'Signed Street 1',
          addressPostalCode: '8000',
          addressCity: 'Zürich',
          addressCountry: 'CH',
          swissTaxResidence: true,
          lang: 'DE',
          signature: '0xSig',
          walletAddress: stepWalletAddress,
          registrationDate: '2026-05-21',
        }),
        isFailed: false,
        isCanceled: false,
        isCompleted: opts.isCompleted ?? true,
        result: 'non-empty',
      };
    }

    it('returns state=ALREADY_REGISTERED when a non-failed step for the current wallet exists', () => {
      const userData = buildVerifiedUserData();
      userData.getStepsWith.mockReturnValue([buildStepForWallet(walletAddress)]);

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.ALREADY_REGISTERED);
      expect(status.isRegistered).toBe(true);
      expect(status.userData).toBeDefined();
      expect(status.userData!.email).toBe('signed@example.com');
      expect(status.userData!.name).toBe('Signed Name');
    });

    it('returns state=ADD_WALLET when a step exists for a different wallet but not the current one', () => {
      const userData = buildVerifiedUserData();
      userData.getStepsWith.mockReturnValue([buildStepForWallet(otherWalletAddress, { isCompleted: true })]);

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.ADD_WALLET);
      expect(status.isRegistered).toBe(false);
      expect(status.userData).toBeDefined();
      // userData comes from the existing signed step, not from KYC fallback
      expect(status.userData!.email).toBe('signed@example.com');
      expect(status.userData!.name).toBe('Signed Name');
    });

    it('returns state=NEW_REGISTRATION when no step exists but userData has firstname/surname', () => {
      const userData = buildVerifiedUserData();

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.isRegistered).toBe(false);
      expect(status.userData).toBeDefined();
      expect(status.userData!.email).toBe('max@example.com');
      expect(status.userData!.name).toBe('Max Mustermann');
      expect(status.userData!.phoneNumber).toBe('+41791234567');
      expect(status.userData!.birthday).toBe('1990-05-21');
      expect(status.userData!.nationality).toBe('CH');
      expect(status.userData!.addressStreet).toBe('Bahnhofstrasse 1');
      expect(status.userData!.addressPostalCode).toBe('8001');
      expect(status.userData!.addressCity).toBe('Zürich');
      expect(status.userData!.addressCountry).toBe('CH');
      expect(status.userData!.swissTaxResidence).toBe(true);
      expect(status.userData!.lang).toBe('DE');
      expect(status.userData!.kycData.firstName).toBe('Max');
      expect(status.userData!.kycData.lastName).toBe('Mustermann');
    });

    it('returns state=KYC_REQUIRED when no step exists and no KYC data is present', () => {
      const userData = {
        firstname: null,
        surname: null,
        getStepsWith: jest.fn().mockReturnValue([]),
      } as any;

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.KYC_REQUIRED);
      expect(status.isRegistered).toBe(false);
      expect(status.userData).toBeUndefined();
    });

    it('defaults swissTaxResidence to false in NEW_REGISTRATION when the residence country is not CH', () => {
      const userData = buildVerifiedUserData();
      userData.country = { id: 2, symbol: 'DE' };

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.userData!.swissTaxResidence).toBe(false);
      expect(status.userData!.addressCountry).toBe('DE');
    });

    it('falls back to EN in NEW_REGISTRATION when the user language is not one of the RealUnit-supported codes', () => {
      const userData = buildVerifiedUserData();
      userData.language = { symbol: 'ES' };

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.userData!.lang).toBe('EN');
    });
  });
});
