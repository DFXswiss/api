import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Wallet } from 'ethers';
import { verifyTypedData } from 'ethers/lib/utils';
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
import { PriceInvalidException } from '../../pricing/domain/exceptions/price-invalid.exception';
import { RealUnitDevService } from '../realunit-dev.service';
import { PriceSourceUnavailableException } from '../exceptions/price-source-unavailable.exception';
import { RealUnitService } from '../realunit.service';

let mockEnvironment = 'loc';

jest.mock('src/config/config', () => ({
  get Config() {
    return {
      environment: mockEnvironment,
      blockchain: {
        realunit: { api: { url: 'https://mock-api.example.com', key: 'mock-key' } },
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
        { provide: HttpService, useValue: { post: jest.fn() } },
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
        { provide: FeeService, useValue: {} },
        { provide: FaucetRequestService, useValue: {} },
        { provide: EthereumService, useValue: {} },
        { provide: SepoliaService, useValue: {} },
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
});
