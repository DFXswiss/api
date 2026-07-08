import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Wallet } from 'ethers';
import { verifyTypedData } from 'ethers/lib/utils';
import { request } from 'graphql-request';
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
import {
  TransactionRequestStatus,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { RealUnitAktionariatConfirmationStatus } from '../dto/realunit-confirm-aktionariat.dto';
import { RealUnitRegistrationState, RealUnitRegistrationStatus } from '../dto/realunit-registration.dto';
import { PriceInvalidException } from '../../pricing/domain/exceptions/price-invalid.exception';
import { RealUnitDevService } from '../realunit-dev.service';
import { RealUnitAddressConfirmationRepository } from '../repositories/realunit-address-confirmation.repository';
import { PriceSourceUnavailableException } from '../exceptions/price-source-unavailable.exception';
import { RealUnitService } from '../realunit.service';

let mockEnvironment = 'loc';
let mockAktionariatUrl: string | undefined = 'https://mock-aktionariat.example.com';

jest.mock('src/config/config', () => ({
  get Config() {
    return {
      environment: mockEnvironment,
      blockchain: {
        realunit: {
          api: { url: 'https://mock-api.example.com', key: 'mock-key' },
          aktionariatUrl: mockAktionariatUrl,
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

// keep the real `gql` tag (used by ./utils/queries), stub only the network `request`
jest.mock('graphql-request', () => ({
  ...jest.requireActual('graphql-request'),
  request: jest.fn(),
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
  let userDataService: jest.Mocked<UserDataService>;
  let httpService: jest.Mocked<HttpService>;
  let addressConfirmationRepo: jest.Mocked<RealUnitAddressConfirmationRepository>;

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
        { provide: UserDataService, useValue: { getUsersByMail: jest.fn() } },
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
            saveKycStepUpdate: jest.fn(),
          },
        },
        { provide: CountryService, useValue: {} },
        { provide: LanguageService, useValue: {} },
        { provide: HttpService, useValue: { post: jest.fn(), getRaw: jest.fn() } },
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
            getTransactionRequest: jest.fn(),
            complete: jest.fn(),
          },
        },
        { provide: TransactionService, useValue: {} },
        { provide: AccountMergeService, useValue: {} },
        { provide: RealUnitDevService, useValue: { simulatePaymentForRequest: jest.fn() } },
        { provide: SwissQRService, useValue: {} },
        { provide: FeeService, useValue: {} },
        { provide: FaucetRequestService, useValue: {} },
        { provide: EthereumService, useValue: {} },
        { provide: SepoliaService, useValue: {} },
        {
          provide: RealUnitAddressConfirmationRepository,
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((partial) => ({ ...partial })),
            save: jest.fn((entity) => entity),
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
    userDataService = module.get(UserDataService);
    httpService = module.get(HttpService);
    addressConfirmationRepo = module.get(RealUnitAddressConfirmationRepository);
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

  describe('confirmPaymentReceived (REALU scoping)', () => {
    // mockEnvironment stays at its 'loc' default so confirmPaymentReceived takes the DEV
    // simulation path (devService.simulatePaymentForRequest), never the PRD payAndAllocate path.
    const waitingBuyQuote = {
      id: 1,
      type: TransactionRequestType.BUY,
      status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
      targetId: realuAsset.id,
      sourceId: 99,
      user: { id: 42, address: '0xUserAddress' },
    };

    const devService = () => (service as any).devService.simulatePaymentForRequest as jest.Mock;

    beforeEach(() => {
      assetService.getAssetByQuery.mockResolvedValue(realuAsset);
    });

    it('should throw NotFoundException if the request does not exist', async () => {
      transactionRequestService.getTransactionRequest.mockResolvedValue(undefined);

      await expect(service.confirmPaymentReceived(1)).rejects.toThrow(NotFoundException);
      expect(devService()).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a non-REALU buy quote (targetId mismatch)', async () => {
      transactionRequestService.getTransactionRequest.mockResolvedValue({ ...waitingBuyQuote, targetId: 99 } as any);

      await expect(service.confirmPaymentReceived(1)).rejects.toThrow(NotFoundException);
      expect(devService()).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a SWAP quote even when targetId matches REALU', async () => {
      transactionRequestService.getTransactionRequest.mockResolvedValue({
        ...waitingBuyQuote,
        type: TransactionRequestType.SWAP,
      } as any);

      await expect(service.confirmPaymentReceived(1)).rejects.toThrow(NotFoundException);
      expect(devService()).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for a REALU buy quote not in WaitingForPayment status', async () => {
      transactionRequestService.getTransactionRequest.mockResolvedValue({
        ...waitingBuyQuote,
        status: TransactionRequestStatus.COMPLETED,
      } as any);

      await expect(service.confirmPaymentReceived(1)).rejects.toThrow(BadRequestException);
      expect(devService()).not.toHaveBeenCalled();
    });

    it('should simulate payment for a waiting REALU buy quote (dev/loc path)', async () => {
      transactionRequestService.getTransactionRequest.mockResolvedValue(waitingBuyQuote as any);

      await service.confirmPaymentReceived(1);

      expect(devService()).toHaveBeenCalledWith(waitingBuyQuote, realuAsset);
    });

    it('should throw BadRequestException for a REALU sell quote even when scoped and waiting (only buy quotes can be confirmed)', async () => {
      // sourceId == realuAsset.id makes this a properly-scoped REALU sell quote (getRealuQuote matches
      // sourceId for SELL), so reaching BadRequestException — not NotFoundException — proves the 404
      // scoping passed and the buy-only guard is what rejects it.
      const waitingSellQuote = {
        ...waitingBuyQuote,
        type: TransactionRequestType.SELL,
        sourceId: realuAsset.id,
        targetId: 99,
      };
      transactionRequestService.getTransactionRequest.mockResolvedValue(waitingSellQuote as any);

      await expect(service.confirmPaymentReceived(1)).rejects.toThrow(BadRequestException);
      expect(devService()).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for a sell quote whose targetId (not sourceId) collides with the REALU asset id', async () => {
      // Adversarial scoping check: a sell quote where the fiat targetId happens to equal realuAsset.id.
      // getRealuQuote only matches sourceId for SELL, so this must never be treated as a REALU quote.
      const foreignSellQuote = {
        ...waitingBuyQuote,
        type: TransactionRequestType.SELL,
        sourceId: 99,
        targetId: realuAsset.id,
      };
      transactionRequestService.getTransactionRequest.mockResolvedValue(foreignSellQuote as any);

      await expect(service.confirmPaymentReceived(1)).rejects.toThrow(NotFoundException);
      expect(devService()).not.toHaveBeenCalled();
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

    it('returns state=NEW_REGISTRATION with no userData when no step exists and no KYC data is present (first-time user gets an empty form)', () => {
      const userData = {
        firstname: null,
        surname: null,
        getStepsWith: jest.fn().mockReturnValue([]),
      } as any;

      const status = service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
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

  describe('withPriceSourceGuard (Aktionariat price source)', () => {
    it('rethrows as PriceSourceUnavailableException (503) when a PriceInvalidException is thrown', async () => {
      let caught: unknown;
      try {
        await (service as any).withPriceSourceGuard(() =>
          Promise.reject(new PriceInvalidException('No valid price found for REALU -> CHF')),
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(PriceSourceUnavailableException);
      expect((caught as PriceSourceUnavailableException).getStatus()).toBe(503);
      expect((caught as PriceSourceUnavailableException).getResponse()).toMatchObject({
        code: 'PRICE_SOURCE_UNAVAILABLE',
      });
    });

    it('rethrows the original error for non-price failures', async () => {
      const original = new Error('some unrelated failure');

      await expect((service as any).withPriceSourceGuard(() => Promise.reject(original))).rejects.toBe(original);
    });

    it('returns the result unchanged on success', async () => {
      await expect((service as any).withPriceSourceGuard(() => Promise.resolve('ok'))).resolves.toBe('ok');
    });
  });

  describe('forwardRegistration (forwards the signed representation to Aktionariat)', () => {
    // Hardhat test accounts — synthetic keys, never real user wallets.
    const softwareWallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    // Stands in for a BitBox the user adds later (hardware can only sign ASCII).
    const hardwareWallet = new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

    const domain = { name: 'RealUnitUser', version: '1' };
    const types = {
      RealUnitUser: [
        { name: 'email', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'type', type: 'string' },
        { name: 'phoneNumber', type: 'string' },
        { name: 'birthday', type: 'string' },
        { name: 'nationality', type: 'string' },
        { name: 'addressStreet', type: 'string' },
        { name: 'addressPostalCode', type: 'string' },
        { name: 'addressCity', type: 'string' },
        { name: 'addressCountry', type: 'string' },
        { name: 'swissTaxResidence', type: 'bool' },
        { name: 'registrationDate', type: 'string' },
        { name: 'walletAddress', type: 'address' },
      ],
    };

    // UTF-8 originals as persisted on the KYC step / user_data.
    const utf8Fields = (walletAddress: string) => ({
      email: 'erika.example@example.com',
      name: 'Erika Müller',
      type: 'HUMAN',
      phoneNumber: '+41790000000',
      birthday: '1990-01-01',
      nationality: 'CH',
      addressStreet: 'Bahnhofstrasse 1',
      addressPostalCode: '8001',
      addressCity: 'Zürich',
      addressCountry: 'CH',
      swissTaxResidence: true,
      registrationDate: '2026-06-08',
      walletAddress,
    });

    // BitBox-safe ASCII transliteration of the same fields — what the wallet signs.
    const asciiFields = (walletAddress: string) => ({
      ...utf8Fields(walletAddress),
      name: 'Erika Mueller',
      addressCity: 'Zuerich',
    });

    const buildDto = (fields: Record<string, unknown>, signature: string): any => ({
      ...fields,
      signature,
      lang: 'DE',
      kycData: {},
    });

    const fakeKycStep = (): any => ({
      id: 1,
      userData: { kycLevel: 999 },
      complete: jest.fn().mockReturnValue([1, {}]),
      manualReview: jest.fn().mockReturnValue([1, {}]),
    });

    const forwardedPayload = (): any => ((service as any).http.post as jest.Mock).mock.calls[0][1];

    // What Aktionariat does: recover the signer from the forwarded payload and compare to walletAddress.
    const recoverFromForwarded = (p: any): string =>
      verifyTypedData(
        domain,
        types,
        {
          email: p.email,
          name: p.name,
          type: p.type,
          phoneNumber: p.phoneNumber,
          birthday: p.birthday,
          nationality: p.nationality,
          addressStreet: p.addressStreet,
          addressPostalCode: p.addressPostalCode,
          addressCity: p.addressCity,
          addressCountry: p.addressCountry,
          swissTaxResidence: p.swissTaxResidence,
          registrationDate: p.registrationDate,
          walletAddress: p.walletAddress,
        },
        p.signature,
      );

    beforeEach(() => {
      mockEnvironment = 'prd';
    });

    afterEach(() => {
      mockEnvironment = 'loc';
    });

    // REGRESSION GUARD: a legacy software wallet that signed the raw UTF-8 fields
    // (still accepted by verifyRealUnitRegistrationSignature) must keep working —
    // the forward must stay UTF-8, not be transliterated, or Aktionariat rejects it.
    it('forwards the raw UTF-8 fields unchanged when the wallet signed UTF-8 (legacy app)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);

      const ok = await (service as any).forwardRegistration(fakeKycStep(), dto);

      expect(ok).toBe(true);
      const payload = forwardedPayload();
      expect(payload.name).toBe('Erika Müller');
      expect(payload.addressCity).toBe('Zürich');
      // Aktionariat re-verifies the signature against the payload it receives.
      expect(recoverFromForwarded(payload).toLowerCase()).toBe(wallet.toLowerCase());
    });

    it('forwards the BitBox-safe ASCII fields when the wallet signed ASCII (current app), even though the dto stores UTF-8', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, asciiFields(wallet));
      // dto carries the UTF-8 originals as stored; only the signature is over ASCII.
      const dto = buildDto(utf8Fields(wallet), signature);

      const ok = await (service as any).forwardRegistration(fakeKycStep(), dto);

      expect(ok).toBe(true);
      const payload = forwardedPayload();
      expect(payload.name).toBe('Erika Mueller');
      expect(payload.addressCity).toBe('Zuerich');
      expect(recoverFromForwarded(payload).toLowerCase()).toBe(wallet.toLowerCase());
    });

    it('supports the software→hardware switch: a BitBox-signed (ASCII-only) wallet verifies against the forwarded payload', async () => {
      const wallet = hardwareWallet.address;
      const signature = await hardwareWallet._signTypedData(domain, types, asciiFields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);

      const ok = await (service as any).forwardRegistration(fakeKycStep(), dto);

      expect(ok).toBe(true);
      const [url, payload] = ((service as any).http.post as jest.Mock).mock.calls[0];
      expect(url).toContain('/registerUser');
      expect(payload.name).toBe('Erika Mueller');
      expect(recoverFromForwarded(payload).toLowerCase()).toBe(wallet.toLowerCase());
    });

    it('resolveSignedRegistrationMessage returns undefined when a valid signature does not belong to the claimed wallet', async () => {
      // Valid signature from the software wallet, but the dto claims a different wallet address.
      const signature = await softwareWallet._signTypedData(domain, types, asciiFields(softwareWallet.address));
      const dto = buildDto(utf8Fields(hardwareWallet.address), signature);

      expect((service as any).resolveSignedRegistrationMessage(dto)).toBeUndefined();
    });
  });

  describe('ponder queries (GraphQL injection protection)', () => {
    const requestMock = request as jest.Mock;
    const emptyHolders = {
      totalSupplys: { items: [] },
      accounts: {
        items: [],
        pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
        totalCount: 0,
      },
    };

    const emptyHistory = {
      account: {
        address: '0xabc',
        addressType: 'EOA',
        history: {
          items: [],
          totalCount: 0,
          pageInfo: { endCursor: null, hasNextPage: false, hasPreviousPage: false, startCursor: null },
        },
      },
    };

    // a real payload observed in prod against /v1/realunit/holders
    const injection =
      'zzz") { items { address } } __schema { queryType { name } } x: accounts(where: { balance_gt: "0" })';

    it('passes the holders cursor as a GraphQL variable, never interpolated into the query', async () => {
      requestMock.mockResolvedValue(emptyHolders);

      await service.getHolders(2, undefined, injection);

      expect(requestMock).toHaveBeenCalledTimes(1);
      const [url, query, variables] = requestMock.mock.calls[0];
      expect(url).toBe('https://mock-ponder.example.com');
      expect(variables).toEqual({ limit: 2, before: null, after: injection });
      // the query document is static and parameterized; the payload stays in variables only
      expect(query).toContain('$after');
      expect(query).not.toContain('__schema');
      expect(query).not.toContain(injection);
    });

    it('sends the same static holders document regardless of the cursor value', async () => {
      requestMock.mockResolvedValue(emptyHolders);

      await service.getHolders(2, undefined, 'cursorA');
      await service.getHolders(5, undefined, injection);

      expect(requestMock.mock.calls[1][1]).toBe(requestMock.mock.calls[0][1]);
    });

    it('passes the account history before cursor as a GraphQL variable, never interpolated into the query', async () => {
      requestMock.mockResolvedValue(emptyHistory);

      await service.getAccountHistory('0xabc', 2, injection);

      expect(requestMock).toHaveBeenCalledTimes(1);
      const [url, query, variables] = requestMock.mock.calls[0];
      expect(url).toBe('https://mock-ponder.example.com');
      expect(variables).toEqual({ id: '0xabc', limit: 2, before: injection, after: null });
      // the query document is static and parameterized; the payload stays in variables only
      expect(query).toContain('$before');
      expect(query).not.toContain('__schema');
      expect(query).not.toContain(injection);
    });

    it('passes the account address as a variable, lower-cased', async () => {
      requestMock.mockResolvedValue({ account: null });

      await expect(service.getAccount('0xAbC')).rejects.toBeDefined();

      const [, query, variables] = requestMock.mock.calls[0];
      expect(variables).toEqual({ id: '0xabc' });
      expect(query).toContain('$id');
      expect(query).not.toContain('0xAbC');
    });
  });

  describe('confirmAktionariat', () => {
    const email = 'user@example.com';
    const code = 'CONFIRM-CODE';
    const user = 'aktionariat-user-1';
    const walletA = '0xAAA0000000000000000000000000000000000001';
    const walletB = '0xbbb0000000000000000000000000000000000002';

    // Fake UserData exposing only the getStepsWith() shape the flow consumes. `undefined` entries
    // model a REALUNIT_REGISTRATION step whose result carries no walletAddress.
    const buildUserData = (walletAddresses: (string | undefined)[]) =>
      ({
        getStepsWith: () => walletAddresses.map((walletAddress) => ({ getResult: () => ({ walletAddress }) })),
      }) as any;

    afterEach(() => {
      mockEnvironment = 'loc';
      mockAktionariatUrl = 'https://mock-aktionariat.example.com';
    });

    it('returns confirmed via the deterministic DEV/LOC mock and stores a new record', async () => {
      userDataService.getUsersByMail.mockResolvedValue([buildUserData([walletA])]);
      addressConfirmationRepo.findOne.mockResolvedValue(undefined);

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      expect(result.confirmedAddresses).toEqual([walletA]);
      expect(result.confirmedDate).toBeInstanceOf(Date);
      expect(httpService.getRaw).not.toHaveBeenCalled();
      expect(addressConfirmationRepo.create).toHaveBeenCalledWith({ walletAddress: walletA });
      expect(addressConfirmationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ walletAddress: walletA, email, aktionariatUser: user, aktionariatCode: code }),
      );
    });

    it('de-duplicates wallets across users case-insensitively and persists each once', async () => {
      userDataService.getUsersByMail.mockResolvedValue([
        buildUserData([walletA, undefined]),
        buildUserData([walletA.toLowerCase(), walletB]),
      ]);
      addressConfirmationRepo.findOne.mockResolvedValue(undefined);

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.confirmedAddresses).toEqual([walletA, walletB]);
      expect(addressConfirmationRepo.save).toHaveBeenCalledTimes(2);
    });

    it('warns and persists nothing when no RealUnit registration wallet exists', async () => {
      userDataService.getUsersByMail.mockResolvedValue([]);

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      expect(result.confirmedAddresses).toEqual([]);
      expect(addressConfirmationRepo.save).not.toHaveBeenCalled();
      expect((service as any).logger.warn).toHaveBeenCalled();
    });

    it('masks an email without an @ sign without crashing', async () => {
      userDataService.getUsersByMail.mockResolvedValue([]);

      const result = await service.confirmAktionariat({ email: 'no-at-sign', code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
    });

    it('calls the real Aktionariat endpoint and maps a 2xx to confirmed', async () => {
      mockEnvironment = 'prd';
      userDataService.getUsersByMail.mockResolvedValue([buildUserData([walletA])]);
      addressConfirmationRepo.findOne.mockResolvedValue(undefined);
      httpService.getRaw.mockResolvedValue({ status: 200, data: { status: 200, message: 'ok' } } as any);

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      const calledUrl = httpService.getRaw.mock.calls[0][0] as string;
      expect(calledUrl).toContain('https://mock-aktionariat.example.com/confirmconnection');
      expect(calledUrl).toContain(`code=${encodeURIComponent(code)}`);
      // An explicit request timeout must be passed so a hung connection resolves to unavailable.
      expect(httpService.getRaw).toHaveBeenCalledWith(expect.any(String), { timeout: 10000 });
    });

    it('maps a 4xx (403 Code not found) to invalid and updates the existing record without clearing confirmedDate', async () => {
      mockEnvironment = 'prd';
      const priorDate = new Date('2026-01-01T00:00:00.000Z');
      userDataService.getUsersByMail.mockResolvedValue([buildUserData([walletA])]);
      addressConfirmationRepo.findOne.mockResolvedValue({ walletAddress: walletA, confirmedDate: priorDate } as any);
      httpService.getRaw.mockRejectedValue({
        response: { status: 403, data: { status: 403, message: 'Code not found' } },
      });

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.INVALID);
      expect(result.confirmedAddresses).toEqual([]);
      expect(result.confirmedDate).toBeUndefined();
      expect(addressConfirmationRepo.create).not.toHaveBeenCalled();
      expect(addressConfirmationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ walletAddress: walletA, confirmedDate: priorDate, responseStatus: 403 }),
      );
      expect((service as any).logger.error).toHaveBeenCalled();
    });

    it('maps a 5xx to unavailable (string error body)', async () => {
      mockEnvironment = 'prd';
      userDataService.getUsersByMail.mockResolvedValue([buildUserData([walletA])]);
      addressConfirmationRepo.findOne.mockResolvedValue(undefined);
      httpService.getRaw.mockRejectedValue({ response: { status: 503, data: 'Service Unavailable' } });

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.UNAVAILABLE);
      expect(result.confirmedAddresses).toEqual([]);
      expect(addressConfirmationRepo.save).toHaveBeenCalledWith(expect.objectContaining({ responseStatus: 503 }));
    });

    it('maps a network/timeout error (Error with message) to unavailable', async () => {
      mockEnvironment = 'prd';
      userDataService.getUsersByMail.mockResolvedValue([buildUserData([walletA])]);
      addressConfirmationRepo.findOne.mockResolvedValue(undefined);
      httpService.getRaw.mockRejectedValue(new Error('timeout of 30000ms exceeded'));

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.UNAVAILABLE);
      expect(addressConfirmationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ walletAddress: walletA, responseStatus: undefined }),
      );
    });

    it('maps an error with neither response nor message to unavailable', async () => {
      mockEnvironment = 'prd';
      userDataService.getUsersByMail.mockResolvedValue([buildUserData([walletA])]);
      addressConfirmationRepo.findOne.mockResolvedValue(undefined);
      httpService.getRaw.mockRejectedValue({});

      const result = await service.confirmAktionariat({ email, code, user });

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.UNAVAILABLE);
      expect((service as any).logger.error).toHaveBeenCalled();
    });

    it('throws when AKTIONARIAT_URL is not configured outside DEV/LOC', async () => {
      mockEnvironment = 'prd';
      mockAktionariatUrl = undefined;
      userDataService.getUsersByMail.mockResolvedValue([]);

      await expect(service.confirmAktionariat({ email, code, user })).rejects.toThrow(
        'Aktionariat URL is not configured',
      );
      expect(httpService.getRaw).not.toHaveBeenCalled();
      expect((service as any).logger.error).toHaveBeenCalledWith('Aktionariat URL is not configured');
    });
  });
});
