import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Eip7702DelegationService } from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
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
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { RealUnitDevService } from '../realunit-dev.service';
import { RealUnitService } from '../realunit.service';

jest.mock('src/config/config', () => ({
  get Config() {
    return { environment: 'loc' };
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
  },
}));

describe('RealUnitService', () => {
  let service: RealUnitService;
  let assetService: jest.Mocked<AssetService>;
  let blockchainService: jest.Mocked<RealUnitBlockchainService>;
  let eip7702DelegationService: jest.Mocked<Eip7702DelegationService>;
  let transactionRequestService: jest.Mocked<TransactionRequestService>;
  let sellService: jest.Mocked<SellService>;

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
        { provide: UserService, useValue: {} },
        { provide: KycService, useValue: {} },
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
      ],
    }).compile();

    service = module.get<RealUnitService>(RealUnitService);
    assetService = module.get(AssetService);
    blockchainService = module.get(RealUnitBlockchainService);
    eip7702DelegationService = module.get(Eip7702DelegationService);
    transactionRequestService = module.get(TransactionRequestService);
    sellService = module.get(SellService);
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
        pricePerShare: '100',
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
      );
    });

    it('should return the result from blockchainService', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      const expected = {
        brokerbotAddress: '0xBrokerbotAddress',
        tokenAddress: '0xRealuChainId',
        baseCurrencyAddress: '0xZchfChainId',
        pricePerShare: '100',
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
      expect(blockchainService.getBrokerbotSellPrice).toHaveBeenCalledWith(10);
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
});
