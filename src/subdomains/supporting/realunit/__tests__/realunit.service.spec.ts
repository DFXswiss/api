import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers, Wallet } from 'ethers';
import { verifyTypedData } from 'ethers/lib/utils';
import { request } from 'graphql-request';
import { EthereumService } from 'src/integration/blockchain/ethereum/ethereum.service';
import { BrokerbotCurrency } from 'src/integration/blockchain/realunit/dto/realunit-broker.dto';
import { RealUnitBlockchainService } from 'src/integration/blockchain/realunit/realunit-blockchain.service';
import { SepoliaService } from 'src/integration/blockchain/sepolia/sepolia.service';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import {
  Eip7702DelegationService,
  TransactionRevertedException,
} from 'src/integration/blockchain/shared/evm/delegation/eip7702-delegation.service';
import { EvmUtil } from 'src/integration/blockchain/shared/evm/evm.util';
import { FaucetRequestService } from 'src/subdomains/core/faucet-request/services/faucet-request.service';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { CountryService } from 'src/shared/models/country/country.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { LanguageService } from 'src/shared/models/language/language.service';
import { HttpService } from 'src/shared/services/http.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { PaymentLinkPaymentStatus } from 'src/subdomains/core/payment-link/enums';
import { PaymentLinkPaymentService } from 'src/subdomains/core/payment-link/services/payment-link-payment.service';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { ReviewStatus } from 'src/subdomains/generic/kyc/enums/review-status.enum';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { KycLevel, ServiceProvider } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import {
  TransactionRequestStatus,
  TransactionRequestType,
} from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { LogSeverity } from 'src/subdomains/supporting/log/log.entity';
import { LogService } from 'src/subdomains/supporting/log/log.service';
import { SupportIssueReason, SupportIssueType } from 'src/subdomains/supporting/support-issue/enums/support-issue.enum';
import { SupportIssueService } from 'src/subdomains/supporting/support-issue/services/support-issue.service';
import { FindOperator, IsNull } from 'typeorm';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { RealUnitAktionariatConfirmationStatus } from '../dto/realunit-confirm-aktionariat.dto';
import {
  RealUnitEmailRegistrationStatus,
  RealUnitLanguage,
  RealUnitRegistrationState,
  RealUnitRegistrationStatus,
  RealUnitUserType,
} from '../dto/realunit-registration.dto';
import { PriceInvalidException } from '../../pricing/domain/exceptions/price-invalid.exception';
import { RealUnitDevService } from '../realunit-dev.service';
import { AktionariatRegistration } from '../entities/aktionariat-registration.entity';
import { RealUnitTransferRequestStatus } from '../entities/realunit-transfer-request.entity';
import { AktionariatRegistrationRepository } from '../repositories/aktionariat-registration.repository';
import { RealUnitTransferRequestRepository } from '../repositories/realunit-transfer-request.repository';
import { PriceSourceUnavailableException } from '../exceptions/price-source-unavailable.exception';
import { KycLevelRequiredException, RegistrationRequiredException } from '../exceptions/buy-exceptions';
import { RealUnitService } from '../realunit.service';

let mockEnvironment = 'loc';
let mockAktionariatUrl: string | undefined = 'https://mock-aktionariat.example.com';

// Mutable so individual tests can exercise the W2W gas-wallet config branches (key unset / no 0x prefix /
// address unset). Reset in beforeEach to the funded defaults. jest.mock factories may only close over
// variables prefixed with `mock`.
// The default key is a valid 32-byte private key so the prepare flow can derive the gas-wallet address
// (ethers.Wallet(key).address) — the W2W delegation's `delegate` must equal that derived address.
const mockW2wGasWalletKeyDefault = '0x' + '1'.repeat(64);
// Address derived from mockW2wGasWalletKeyDefault via ethers.Wallet(key).address (delegate == redeemer).
const mockW2wGasWalletAddressDerived = '0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A';
let mockW2wGasWalletPrivateKey: string | undefined = mockW2wGasWalletKeyDefault;
let mockW2wGasWalletAddress: string | undefined = mockW2wGasWalletAddressDerived;

jest.mock('src/config/config', () => ({
  get Config() {
    return {
      environment: mockEnvironment,
      txRequestWaitingExpiryDays: 7,
      prefixes: { realUnitTransferUidPrefix: 'RT' },
      blockchain: {
        realunit: {
          api: { url: 'https://mock-api.example.com', key: 'mock-key' },
          aktionariatUrl: mockAktionariatUrl,
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
        brokerbotAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        graphUrl: 'https://mock-ponder.example.com',
        api: { url: 'https://mock-api.example.com', key: 'mock-key' },
        bank: {
          recipient: 'RealUnit AG',
          iban: 'CH0000000000000000000',
          ibanEur: 'CH1111111111111111111',
          bic: 'MOCKCHZZ',
          name: 'Mock Bank',
        },
        address: { street: 'Bahnhofstrasse', number: '1', zip: '8000', city: 'Zurich', country: 'CH' },
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
    daysBefore: (days: number, from?: Date) => new Date((from ?? new Date()).getTime() - days * 86_400_000),
    daysDiff: jest.fn().mockReturnValue(0),
    minutesBefore: (minutes: number, from?: Date) => new Date((from ?? new Date()).getTime() - minutes * 60_000),
    // The service stamps a per-write uniqueness nonce into every audit message; return a distinct value on
    // each call so two byte-identical events serialise to different messages (mirrors the real randomness).
    randomString: (() => {
      let sequence = 0;
      return () => `MOCK-NONCE-${sequence++}`;
    })(),
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
  let swapService: jest.Mocked<SwapService>;
  let userService: jest.Mocked<UserService>;
  let userDataService: jest.Mocked<UserDataService>;
  let httpService: jest.Mocked<HttpService>;
  let aktionariatRegistrationRepo: jest.Mocked<AktionariatRegistrationRepository>;
  let aktionariatManager: { transaction: jest.Mock };
  let aktionariatTxManager: { update: jest.Mock; save: jest.Mock; query: jest.Mock; findOne: jest.Mock };
  let logService: jest.Mocked<LogService>;
  let fiatService: jest.Mocked<FiatService>;
  let buyService: jest.Mocked<BuyService>;
  let supportIssueService: jest.Mocked<SupportIssueService>;
  let transferRequestRepo: jest.Mocked<RealUnitTransferRequestRepository>;
  let sepoliaClient: {
    chainId: number;
    getTransactionCount: jest.Mock;
    getRecommendedGasPrice: jest.Mock;
    getNativeCoinBalanceForAddress: jest.Mock;
    sendSignedTransaction: jest.Mock;
    getTokenBalance: jest.Mock;
    getTokenBalanceWei: jest.Mock;
    getTxReceipt: jest.Mock;
  };
  let evmClient: typeof sepoliaClient;
  let lnUrlForwardService: jest.Mocked<LnUrlForwardService>;
  let paymentLinkPaymentService: jest.Mocked<PaymentLinkPaymentService>;
  let faucetRequestService: jest.Mocked<FaucetRequestService>;

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
    // Mock the per-wallet persistence transaction: repo.manager.transaction() runs its callback with a
    // distinct transactional EntityManager, so the tests prove the deactivate (update) + insert (save)
    // go through that transactional manager rather than the repository outside the transaction.
    aktionariatTxManager = {
      update: jest.fn(),
      save: jest.fn((entity) => entity),
      query: jest.fn(),
      findOne: jest.fn(),
    };
    aktionariatManager = {
      transaction: jest.fn(async (cb: any) => cb(aktionariatTxManager)),
    };
    sepoliaClient = {
      chainId: 11155111,
      getTransactionCount: jest.fn(),
      getRecommendedGasPrice: jest.fn(),
      getNativeCoinBalanceForAddress: jest.fn(),
      sendSignedTransaction: jest.fn(),
      getTokenBalance: jest.fn().mockResolvedValue(1_000_000),
      getTokenBalanceWei: jest.fn().mockResolvedValue(ethers.BigNumber.from('1000000000000000000000000')),
      getTxReceipt: jest.fn(),
    };
    evmClient = sepoliaClient;

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
            requestPaymentInstructions: jest.fn(),
          },
        },
        {
          provide: UserDataService,
          useValue: { updateUserDataInternal: jest.fn(), updatePersonalData: jest.fn() },
        },
        {
          provide: UserService,
          useValue: {
            getUserByAddress: jest.fn(),
          },
        },
        { provide: KycService, useValue: {} },
        { provide: CountryService, useValue: { getCountryWithSymbol: jest.fn() } },
        { provide: LanguageService, useValue: { getLanguageBySymbol: jest.fn() } },
        { provide: HttpService, useValue: { post: jest.fn(), getRaw: jest.fn() } },
        { provide: FiatService, useValue: { getFiat: jest.fn(), getFiatByName: jest.fn() } },
        { provide: BuyService, useValue: { createBuy: jest.fn(), toPaymentInfoDto: jest.fn() } },
        {
          provide: SellService,
          useValue: {
            getById: jest.fn(),
          },
        },
        {
          provide: SwapService,
          useValue: {
            createSwapPaymentInfo: jest.fn(),
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
            getTransactionRequest: jest.fn(),
            complete: jest.fn(),
            confirmTransactionRequest: jest.fn(),
            claimForBroadcast: jest.fn().mockResolvedValue(true),
            releaseBroadcastClaim: jest.fn(),
          },
        },
        { provide: TransactionService, useValue: {} },
        { provide: AccountMergeService, useValue: {} },
        { provide: RealUnitDevService, useValue: { simulatePaymentForRequest: jest.fn() } },
        { provide: SwissQRService, useValue: {} },
        { provide: FeeService, useValue: {} },
        { provide: FaucetRequestService, useValue: { resetFaucet: jest.fn() } },
        { provide: EthereumService, useValue: { getDefaultClient: jest.fn().mockReturnValue(sepoliaClient) } },
        {
          provide: SepoliaService,
          useValue: {
            getDefaultClient: jest.fn().mockReturnValue(sepoliaClient),
          },
        },

        {
          provide: AktionariatRegistrationRepository,
          useValue: {
            create: jest.fn((partial) => ({ ...partial })),
            save: jest.fn((entity) => entity),
            findOne: jest.fn(),
            find: jest.fn(),
            manager: aktionariatManager,
          },
        },
        {
          provide: LogService,
          useValue: {
            create: jest.fn(),
          },
        },
        {
          provide: SupportIssueService,
          useValue: {
            createIssueInternal: jest.fn(),
          },
        },
        {
          provide: RealUnitTransferRequestRepository,
          useValue: {
            create: jest.fn((e) => e),
            save: jest.fn((e) => Promise.resolve({ id: 99, ...e })),
            findOne: jest.fn(),
            find: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] }),
          },
        },
        {
          provide: LnUrlForwardService,
          useValue: {
            lnurlpCallbackForward: jest.fn(),
            txHexForward: jest.fn(),
            waitForPayment: jest.fn(),
          },
        },
        {
          provide: PaymentLinkPaymentService,
          useValue: {
            getMostRecentPayment: jest.fn(),
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
    swapService = module.get(SwapService);
    userService = module.get(UserService);
    userDataService = module.get(UserDataService);
    httpService = module.get(HttpService);
    aktionariatRegistrationRepo = module.get(AktionariatRegistrationRepository);
    logService = module.get(LogService);
    fiatService = module.get(FiatService);
    buyService = module.get(BuyService);
    supportIssueService = module.get(SupportIssueService);
    transferRequestRepo = module.get(RealUnitTransferRequestRepository);
    lnUrlForwardService = module.get(LnUrlForwardService);
    paymentLinkPaymentService = module.get(PaymentLinkPaymentService);
    faucetRequestService = module.get(FaucetRequestService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getBrokerbotInfo', () => {
    it('should call assetService.getAssetByQuery for REALU and ZCHF', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      blockchainService.getBrokerbotInfo.mockResolvedValue({
        brokerbotAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
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
        '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
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
        '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        '0xRealuChainId',
        '0xZchfChainId',
        BrokerbotCurrency.EUR,
      );
    });

    it('should return the result from blockchainService', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(realuAsset).mockResolvedValueOnce(zchfAsset);
      const expected = {
        brokerbotAddress: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
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
      expect(blockchainService.getBrokerbotSellPrice).toHaveBeenCalledWith(
        '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        10,
      );
      expect(eip7702DelegationService.executeBrokerBotSellForRealUnit).toHaveBeenCalledWith(
        userAddress,
        realuAsset,
        '0xZchfChainId',
        '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
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

  describe('getPaymentInfo (primary-email pre-tap gate)', () => {
    const buildBuyPaymentInfo = (overrides: Partial<any> = {}): any => ({
      id: 10,
      routeId: 20,
      timestamp: new Date(),
      amount: 100,
      currency: { name: 'CHF' },
      fees: {},
      minVolume: 1,
      maxVolume: 1000,
      minVolumeTarget: 1,
      maxVolumeTarget: 1000,
      exchangeRate: 1,
      rate: 1,
      priceSteps: [],
      estimatedAmount: 99,
      isValid: true,
      error: undefined,
      ...overrides,
    });

    const buildUser = (mail?: string): any => ({
      id: 42,
      address: '0xUserAddress',
      userData: { mail, kycLevel: KycLevel.LEVEL_30 },
    });

    const buildRegistration = (overrides: Partial<AktionariatRegistration> = {}): AktionariatRegistration =>
      ({
        requiresEmailConfirmation: false,
        confirmedDate: undefined,
        ...overrides,
      }) as AktionariatRegistration;

    beforeEach(() => {
      jest.spyOn(service as any, 'findRegistration').mockResolvedValue({
        registration: buildRegistration(),
        isForCurrentWallet: true,
      });
      jest.spyOn(service, 'getRealuAsset').mockResolvedValue(realuAsset);
      jest.spyOn(service as any, 'generatePaymentRequest').mockReturnValue('MOCK-QR');
      fiatService.getFiatByName.mockResolvedValue({ name: 'CHF' } as any);
      buyService.createBuy.mockResolvedValue({ bankUsage: 'MOCK-USAGE', active: true } as any);
    });

    it('surfaces a missing primary email as isValid:false with error PrimaryEmailRequired and no payment request', async () => {
      buyService.toPaymentInfoDto.mockResolvedValue(buildBuyPaymentInfo({ isValid: true, error: undefined }));

      const result = await service.getPaymentInfo(buildUser(undefined), { amount: 100 });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.PRIMARY_EMAIL_REQUIRED);
      expect(result.paymentRequest).toBeUndefined();
      expect((service as any).generatePaymentRequest).not.toHaveBeenCalled();
    });

    it('prefers PrimaryEmailRequired over PrimaryEmailNotConfirmed when the email is missing AND unconfirmed', async () => {
      (service as any).findRegistration.mockResolvedValue({
        registration: buildRegistration({ requiresEmailConfirmation: true, confirmedDate: undefined }),
        isForCurrentWallet: true,
      });
      buyService.toPaymentInfoDto.mockResolvedValue(buildBuyPaymentInfo({ isValid: true, error: undefined }));

      const result = await service.getPaymentInfo(buildUser(undefined), { amount: 100 });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.PRIMARY_EMAIL_REQUIRED);
      expect(result.paymentRequest).toBeUndefined();
    });

    it('returns a valid quote when an email-confirmation registration has a confirmedDate', async () => {
      const confirmedDate = new Date('2026-06-01T00:00:00.000Z');
      (service as any).findRegistration.mockResolvedValue({
        registration: buildRegistration({ requiresEmailConfirmation: true, confirmedDate }),
        isForCurrentWallet: true,
      });
      buyService.toPaymentInfoDto.mockResolvedValue(buildBuyPaymentInfo({ isValid: true, error: undefined }));

      const result = await service.getPaymentInfo(buildUser('max@example.com'), { amount: 100 });

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.paymentRequest).toBe('MOCK-QR');
    });

    it('returns a valid quote for a grandfathered registration without a confirmedDate', async () => {
      (service as any).findRegistration.mockResolvedValue({
        registration: buildRegistration({ requiresEmailConfirmation: false, confirmedDate: undefined }),
        isForCurrentWallet: true,
      });
      buyService.toPaymentInfoDto.mockResolvedValue(buildBuyPaymentInfo({ isValid: true, error: undefined }));

      const result = await service.getPaymentInfo(buildUser('max@example.com'), { amount: 100 });

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('surfaces an unconfirmed registration email and withholds the payment request', async () => {
      (service as any).findRegistration.mockResolvedValue({
        registration: buildRegistration({ requiresEmailConfirmation: true, confirmedDate: undefined }),
        isForCurrentWallet: true,
      });
      buyService.toPaymentInfoDto.mockResolvedValue(buildBuyPaymentInfo({ isValid: true, error: undefined }));

      const result = await service.getPaymentInfo(buildUser('max@example.com'), { amount: 100 });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.PRIMARY_EMAIL_NOT_CONFIRMED);
      expect(result.paymentRequest).toBeUndefined();
      expect((service as any).generatePaymentRequest).not.toHaveBeenCalled();
    });

    it('passes a pre-existing quote error through unchanged when the user has a primary email', async () => {
      buyService.toPaymentInfoDto.mockResolvedValue(
        buildBuyPaymentInfo({ isValid: false, error: QuoteError.AMOUNT_TOO_LOW }),
      );

      const result = await service.getPaymentInfo(buildUser('max@example.com'), { amount: 100 });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.AMOUNT_TOO_LOW);
      expect(result.paymentRequest).toBeUndefined();
    });

    it('prefers a harder pre-existing quote error over the missing-primary-email signal', async () => {
      (service as any).findRegistration.mockResolvedValue({
        registration: buildRegistration({ requiresEmailConfirmation: true, confirmedDate: undefined }),
        isForCurrentWallet: true,
      });
      buyService.toPaymentInfoDto.mockResolvedValue(
        buildBuyPaymentInfo({ isValid: false, error: QuoteError.AMOUNT_TOO_LOW }),
      );

      const result = await service.getPaymentInfo(buildUser(undefined), { amount: 100 });

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.AMOUNT_TOO_LOW);
      expect(result.paymentRequest).toBeUndefined();
    });

    it('rejects the buy with RegistrationRequiredException when the wallet is not RealUnit-registered', async () => {
      (service as any).findRegistration.mockResolvedValue({ registration: undefined, isForCurrentWallet: false });

      await expect(service.getPaymentInfo(buildUser('max@example.com'), { amount: 100 })).rejects.toBeInstanceOf(
        RegistrationRequiredException,
      );
    });
  });

  describe('getSellPaymentInfo (registration gate)', () => {
    const buildUser = (kycLevel: KycLevel): any => ({ id: 42, address: '0xUserAddress', userData: { kycLevel } });

    it('rejects the sell with RegistrationRequiredException when the wallet is not RealUnit-registered', async () => {
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(false);

      await expect(
        service.getSellPaymentInfo(buildUser(KycLevel.LEVEL_30), { amount: 1 } as any),
      ).rejects.toBeInstanceOf(RegistrationRequiredException);
    });

    it('passes the registration gate when registered (the next KYC-level gate rejects, not the registration one)', async () => {
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(true);

      // KYC level below 30 makes the very next gate throw — proving the registration gate was passed
      const error = await service
        .getSellPaymentInfo(buildUser(KycLevel.LEVEL_10), { amount: 1 } as any)
        .catch((e) => e);

      expect(error).toBeInstanceOf(KycLevelRequiredException);
      expect(error).not.toBeInstanceOf(RegistrationRequiredException);
    });
  });

  describe('hasRegistrationForWallet (delegates to findRegistration)', () => {
    const userData = { id: 1 } as any;

    it('returns true for an active non-terminal registration on the current wallet', async () => {
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce({ id: 1, status: ReviewStatus.COMPLETED } as any);

      await expect(service.hasRegistrationForWallet(userData, '0xabc')).resolves.toBe(true);
    });

    it('returns false when no registration row exists for the wallet', async () => {
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      await expect(service.hasRegistrationForWallet(userData, '0xabc')).resolves.toBe(false);
    });

    it('queries only active, non-terminal registrations for the current wallet (fail-closed gate)', async () => {
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      await service.hasRegistrationForWallet(userData, '0xAbC');

      const where = (aktionariatRegistrationRepo.findOne as jest.Mock).mock.calls[0][0].where;
      expect(where.active).toBe(true);
      expect(where.walletAddress).toBe('0xabc');
      // the compliance gate must exclude terminal FAILED/CANCELED rows: status = Not(In([FAILED, CANCELED]))
      expect(where.status).toBeInstanceOf(FindOperator);
      expect(where.status.type).toBe('not');
      expect(where.status.child.type).toBe('in');
      expect(where.status.child.value).toEqual([ReviewStatus.FAILED, ReviewStatus.CANCELED]);
    });
  });

  describe('confirmBuy (Aktionariat error mapping)', () => {
    const buyRequest = {
      id: 1,
      isValid: true,
      status: TransactionRequestStatus.CREATED,
      created: new Date(),
      sourceId: 3,
      amount: 11,
      estimatedAmount: 7,
      user: { id: 42, address: '0xUserAddress' },
    };

    const aktionariatError = (status: number, data: any) => ({ response: { status, data } });

    beforeEach(() => {
      // PRD path: DEV/LOC mock Aktionariat, so the error mapping is only reachable in PRD
      mockEnvironment = 'prd';
      transactionRequestService.getOrThrow.mockResolvedValue(buyRequest as any);
      fiatService.getFiat.mockResolvedValue({ name: 'CHF' } as any);
    });

    afterEach(() => {
      mockEnvironment = 'loc';
    });

    it('maps the Aktionariat minimum-purchase rejection to 400 with code AmountTooLow', async () => {
      const upstreamMessage = 'Purchases by bank transfer require a minimum nominal amount.';
      blockchainService.requestPaymentInstructions.mockRejectedValue(
        aktionariatError(400, { status: 400, message: upstreamMessage }),
      );

      const error = await service.confirmBuy(42, 1).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({ code: QuoteError.AMOUNT_TOO_LOW, message: upstreamMessage });
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it('maps the Aktionariat missing-primary-email rejection to 400 with code PrimaryEmailRequired', async () => {
      const upstreamMessage = 'User must have a primary email';
      blockchainService.requestPaymentInstructions.mockRejectedValue(
        aktionariatError(400, { status: 400, message: upstreamMessage }),
      );

      const error = await service.confirmBuy(42, 1).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse()).toEqual({ code: QuoteError.PRIMARY_EMAIL_REQUIRED, message: upstreamMessage });
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it.each([
      ['401', aktionariatError(401, { status: 401, message: 'Invalid API key' })],
      ['403', aktionariatError(403, { status: 403, message: 'Forbidden' })],
      ['429', aktionariatError(429, { status: 429, message: 'Too many requests' })],
      ['400 with another message', aktionariatError(400, { status: 400, message: 'User has no primary email.' })],
      ['400 without a message', aktionariatError(400, {})],
      ['500', aktionariatError(500, { status: 500, message: 'Internal server error' })],
      ['network error without response', new Error('connect ETIMEDOUT')],
    ])('keeps an Aktionariat %s as ServiceUnavailableException', async (_, aktionariatFailure) => {
      blockchainService.requestPaymentInstructions.mockRejectedValue(aktionariatFailure);

      const error = await service.confirmBuy(42, 1).catch((e) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it('keeps a 400 with an array message as ServiceUnavailableException', async () => {
      blockchainService.requestPaymentInstructions.mockRejectedValue(
        aktionariatError(400, { status: 400, message: ['User must have a primary email'] }),
      );

      const error = await service.confirmBuy(42, 1).catch((e) => e);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
    });

    it('confirms the request and returns the reference on success', async () => {
      blockchainService.requestPaymentInstructions.mockResolvedValue({ reference: 'REF-123' });

      const result = await service.confirmBuy(42, 1);

      expect(result.reference).toBe('REF-123');
      expect(blockchainService.requestPaymentInstructions).toHaveBeenCalledWith({
        currency: 'CHF',
        address: '0xUserAddress',
        shares: 7,
        price: 1100,
      });
      expect(transactionRequestService.confirmTransactionRequest).toHaveBeenCalledWith(
        buyRequest,
        JSON.stringify({ reference: 'REF-123' }),
      );
    });
  });

  // Valid EVM addresses (checksummed) for the serialization / encoding paths
  const userAddress = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
  const realuContract = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
  const zchfContract = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512';
  const dfxDepositAddress = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

  const realuTxAsset = createCustomAsset({
    id: 1,
    name: 'REALU',
    blockchain: Blockchain.SEPOLIA,
    type: AssetType.TOKEN,
    chainId: realuContract,
    decimals: 0,
  });

  const zchfTxAsset = createCustomAsset({
    id: 2,
    name: 'ZCHF',
    blockchain: Blockchain.SEPOLIA,
    type: AssetType.TOKEN,
    chainId: zchfContract,
    decimals: 18,
  });

  describe('createSwapUnsignedTransaction', () => {
    const mockRequest = {
      id: 1,
      isValid: true,
      amount: 10,
      routeId: 5,
      type: TransactionRequestType.SWAP,
      sourceId: realuTxAsset.id,
      targetId: zchfTxAsset.id,
      user: { address: userAddress, userData: { kycLevel: KycLevel.LEVEL_30 } },
    };

    beforeEach(() => {
      evmClient.getTransactionCount.mockResolvedValue(7);
      evmClient.getRecommendedGasPrice.mockResolvedValue(ethers.BigNumber.from(1_000_000_000));
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(true);
    });

    it('should build the swap tx without a deposit leg', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      const result = await service.createSwapUnsignedTransaction(42, 1);

      expect(Object.keys(result)).toEqual(['swap']);
      const parsed = ethers.utils.parseTransaction(result.swap);
      expect(parsed.to?.toLowerCase()).toBe(realuTxAsset.chainId.toLowerCase());
      expect(parsed.nonce).toBe(7);
      // brokerbot is not queried for a deposit amount in the swap-only flow
      expect(blockchainService.getBrokerbotSellPrice).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if request is not valid', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue({ ...mockRequest, isValid: false } as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if ETH balance is insufficient for gas', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(0);

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if the REALU asset has no contract address', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery
        .mockResolvedValueOnce(createCustomAsset({ id: realuTxAsset.id, name: 'REALU', chainId: undefined } as any))
        .mockResolvedValueOnce(zchfTxAsset);

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(BadRequestException);
    });

    it('should default REALU decimals to 18 when the asset has no decimals set', async () => {
      // decimals null/undefined exercises the `?? 18` fallback in buildSwapUnsignedTransaction
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      const noDecimalsAsset = createCustomAsset({
        id: realuTxAsset.id,
        name: 'REALU',
        chainId: realuContract,
        decimals: undefined,
      } as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(noDecimalsAsset).mockResolvedValueOnce(zchfTxAsset);

      const result = await service.createSwapUnsignedTransaction(42, 1);

      // request amount 10 -> 10 shares encoded with 18 decimals = 10e18
      const parsed = ethers.utils.parseTransaction(result.swap);
      const iface = new ethers.utils.Interface([
        'function transferAndCall(address to, uint256 value, bytes data) returns (bool)',
      ]);
      const [, value] = iface.decodeFunctionData('transferAndCall', parsed.data);
      expect(value.toString()).toBe(ethers.utils.parseUnits('10', 18).toString());
    });

    it('should throw NotFoundException if the REALU asset is not found', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(undefined as any).mockResolvedValueOnce(zchfTxAsset);

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException if the ZCHF asset is not found', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(undefined as any);

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getSwapPaymentInfo', () => {
    const walletAddress = '0x4444444444444444444444444444444444444444';

    function buildUser(opts: { kycLevel?: number } = {}): any {
      return {
        id: 42,
        address: walletAddress,
        userData: {
          kycLevel: opts.kycLevel ?? KycLevel.LEVEL_30,
        },
      };
    }

    const swapInfo = {
      id: 99,
      uid: 'MOCK-UID',
      routeId: 7,
      timestamp: new Date('2026-06-03T00:00:00.000Z'),
      amount: 10,
      estimatedAmount: 950,
      fees: { dfx: 1, network: 0.5, total: 1.5 } as any,
      minVolume: 1,
      maxVolume: 1000,
      minVolumeTarget: 95,
      maxVolumeTarget: 95000,
      isValid: true,
      error: undefined,
    };

    beforeEach(() => {
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(true);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);
      evmClient.getRecommendedGasPrice.mockResolvedValue(ethers.BigNumber.from(1_000_000_000));
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);
      blockchainService.getBrokerbotSellPrice.mockResolvedValue({ zchfAmountWei: BigInt('960000000000000000000') });
      transactionRequestService.updateEstimatedAmount = jest.fn();
    });

    it('should create an IBAN-free SWAP quote (no iban/Sell route) and return the request id + ZCHF estimate', async () => {
      swapService.createSwapPaymentInfo.mockResolvedValue(swapInfo as any);

      const result = await service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any);

      expect(result.id).toBe(99);
      expect(result.uid).toBe('MOCK-UID');
      expect(result.routeId).toBe(7);
      expect(result.targetAsset).toBe('ZCHF');
      expect(result.isValid).toBe(true);

      // SWAP quote is created via the IBAN-free SwapService path (REALU -> ZCHF), NOT the Sell path
      expect(sellService.getById).not.toHaveBeenCalled();
      const [, dto] = swapService.createSwapPaymentInfo.mock.calls[0];
      expect(dto.sourceAsset.name).toBe('REALU');
      expect(dto.targetAsset.name).toBe('ZCHF');
      // the DTO carries no iban field — the IBAN-free contract
      expect('iban' in dto).toBe(false);

      // estimated ZCHF is anchored to the live on-chain brokerbot price
      expect(result.estimatedAmount).toBe(960);
      expect(transactionRequestService.updateEstimatedAmount).toHaveBeenCalledWith(99, 960);
    });

    it('should NOT throw a KYC-level error on a trading-limit signal — the swap is limit-exempt by design', async () => {
      // KYC trading limits are enforced at the fiat boundary (buy/sell). A REALU -> ZCHF swap is a crypto ->
      // crypto self-custody on-chain action, so the non-fiat RealUnit carve-out in TransactionHelper.getLimits
      // means QuoteError.LIMIT_EXCEEDED can never fire for this pair. Even on a (hypothetical) limit signal the
      // service must surface the DTO error rather than map it to a KYC level.
      swapService.createSwapPaymentInfo.mockResolvedValue({
        ...swapInfo,
        isValid: false,
        error: QuoteError.LIMIT_EXCEEDED,
      } as any);

      const result = await service.getSwapPaymentInfo(buildUser(), { amount: 100000 } as any);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.LIMIT_EXCEEDED);
    });

    it('should require RealUnit registration', async () => {
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(false);

      await expect(service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any)).rejects.toBeInstanceOf(
        RegistrationRequiredException,
      );
      expect(swapService.createSwapPaymentInfo).not.toHaveBeenCalled();
    });

    it('should require KYC Level 30', async () => {
      await expect(
        service.getSwapPaymentInfo(buildUser({ kycLevel: KycLevel.LEVEL_20 }), { amount: 10 } as any),
      ).rejects.toBeInstanceOf(KycLevelRequiredException);
      expect(swapService.createSwapPaymentInfo).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the REALU asset is not found', async () => {
      assetService.getAssetByQuery.mockReset();
      assetService.getAssetByQuery.mockResolvedValueOnce(undefined as any).mockResolvedValueOnce(zchfTxAsset);

      await expect(service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any)).rejects.toThrow(NotFoundException);
      expect(swapService.createSwapPaymentInfo).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the ZCHF asset is not found', async () => {
      assetService.getAssetByQuery.mockReset();
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(undefined as any);

      await expect(service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any)).rejects.toThrow(NotFoundException);
      expect(swapService.createSwapPaymentInfo).not.toHaveBeenCalled();
    });

    it('should keep the SwapService estimate (no brokerbot anchor) when shares floor to 0', async () => {
      // amount < 1 floors to 0 shares: the brokerbot price is not queried and the estimate stays as-is
      swapService.createSwapPaymentInfo.mockResolvedValue({ ...swapInfo, amount: 0.4, estimatedAmount: 0.38 } as any);

      const result = await service.getSwapPaymentInfo(buildUser(), { amount: 0.4 } as any);

      expect(blockchainService.getBrokerbotSellPrice).not.toHaveBeenCalled();
      expect(result.amount).toBe(0);
      expect(result.estimatedAmount).toBe(0.38);
      expect(result.isValid).toBe(false);
      expect(result.error).toBe(QuoteError.AMOUNT_TOO_LOW);
      expect(transactionRequestService.updateEstimatedAmount).not.toHaveBeenCalled();
    });

    it('should floor fractional REALU shares while preserving a valid swap quote', async () => {
      swapService.createSwapPaymentInfo.mockResolvedValue({ ...swapInfo, amount: 10.9, isValid: true } as any);

      const result = await service.getSwapPaymentInfo(buildUser(), { amount: 10.9 } as any);

      expect(result.amount).toBe(10);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
      expect(blockchainService.getBrokerbotSellPrice).toHaveBeenCalledWith(expect.any(String), 10);
    });

    it('should throw PriceSourceUnavailableException when the brokerbot price query fails', async () => {
      swapService.createSwapPaymentInfo.mockResolvedValue(swapInfo as any);
      blockchainService.getBrokerbotSellPrice.mockRejectedValue(new Error('rpc down'));

      await expect(service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any)).rejects.toBeInstanceOf(
        PriceSourceUnavailableException,
      );
      expect(transactionRequestService.updateEstimatedAmount).not.toHaveBeenCalled();
    });

    it('should keep the SwapService estimate when the request has no id (brokerbot anchor skipped)', async () => {
      // swapPaymentInfo.id falsy -> the `brokerbotResult && swapPaymentInfo.id` guard is false
      swapService.createSwapPaymentInfo.mockResolvedValue({ ...swapInfo, id: 0 } as any);

      const result = await service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any);

      expect(result.estimatedAmount).toBe(950);
      expect(transactionRequestService.updateEstimatedAmount).not.toHaveBeenCalled();
    });
  });

  describe('broadcastSwapTransaction', () => {
    const signerWallet = new ethers.Wallet('0x' + '11'.repeat(32));

    const mockRequest = {
      id: 1,
      isValid: true,
      amount: 10,
      routeId: 7,
      type: TransactionRequestType.SWAP,
      sourceId: realuTxAsset.id,
      targetId: zchfTxAsset.id,
      user: { address: signerWallet.address, userData: { kycLevel: KycLevel.LEVEL_30 } },
    };

    const erc677Interface = new ethers.utils.Interface([
      'function transferAndCall(address to, uint256 value, bytes data) returns (bool)',
    ]);
    const swapData = erc677Interface.encodeFunctionData('transferAndCall', [
      '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', // brokerbotAddress from the GetConfig mock
      ethers.BigNumber.from(10), // mockRequest.amount = 10 shares, realuTxAsset.decimals = 0
      '0x',
    ]);

    let txFields: any;
    let unsignedTx: string;
    let broadcastDto: { unsignedTx: string; r: string; s: string; v: number };

    beforeAll(async () => {
      txFields = {
        type: 2,
        chainId: 11155111,
        nonce: 7,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(350_000),
        to: realuContract,
        value: ethers.BigNumber.from(0),
        data: swapData,
        accessList: [],
      };
      unsignedTx = ethers.utils.serializeTransaction(txFields);
      const fullySignedTx = await signerWallet.signTransaction(txFields);
      const { r, s, v } = ethers.utils.parseTransaction(fullySignedTx);
      broadcastDto = { unsignedTx, r: r!, s: s!, v: v! };
    });

    beforeEach(() => {
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(true);
      // clearAllMocks does not reset implementations, but claimForBroadcast is overridden in
      // concurrency tests — re-assert the default so success paths still claim successfully.
      transactionRequestService.claimForBroadcast.mockResolvedValue(true);
    });

    it('should reconstruct the signed hex, broadcast it and return the txHash', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);
      evmClient.sendSignedTransaction.mockResolvedValue({ response: { hash: '0xSwapTxHash' } });

      const result = await service.broadcastSwapTransaction(42, 1, broadcastDto);

      expect(result.txHash).toBe('0xSwapTxHash');
      expect(evmClient.sendSignedTransaction).toHaveBeenCalledTimes(1);
      expect(evmClient.sendSignedTransaction.mock.calls[0][0]).toMatch(/^0x/);
      expect(transactionRequestService.complete).toHaveBeenCalledWith(1);
    });

    it('should throw BadRequestException if the request is not valid', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue({ ...mockRequest, isValid: false } as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the broadcast returns an error', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);
      evmClient.sendSignedTransaction.mockResolvedValue({ error: { message: 'nonce too low' } });

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(faucetRequestService.resetFaucet).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the broadcast returns no transaction hash', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);
      evmClient.sendSignedTransaction.mockResolvedValue({ response: {} });

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(faucetRequestService.resetFaucet).not.toHaveBeenCalled();
    });

    it('rejects a second swap broadcast for the same request after the first one completed it (replay guard)', async () => {
      assetService.getAssetByQuery.mockImplementation((query: any) =>
        Promise.resolve(query.name === 'ZCHF' ? zchfTxAsset : realuTxAsset),
      );
      evmClient.sendSignedTransaction.mockResolvedValue({ response: { hash: '0xSwapTxHash' } });

      const requestFixture = { ...mockRequest, isComplete: false };
      transactionRequestService.complete.mockImplementation(async (id: number) => {
        if (id === requestFixture.id) requestFixture.isComplete = true;
      });
      transactionRequestService.getOrThrow.mockImplementation(async () => ({ ...requestFixture }) as any);

      // 1st broadcast: request not yet complete -> succeeds and marks it complete via complete()
      const first = await service.broadcastSwapTransaction(42, 1, broadcastDto);
      expect(first.txHash).toBe('0xSwapTxHash');
      expect(transactionRequestService.complete).toHaveBeenCalledWith(requestFixture.id);
      expect(requestFixture.isComplete).toBe(true);

      // 2nd broadcast: getOrThrow now reflects isComplete=true BECAUSE complete() set it on the fixture
      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(ConflictException);
      expect(evmClient.sendSignedTransaction).toHaveBeenCalledTimes(1); // not called again on the replay
    });

    it('rejects a concurrent second broadcast when claimForBroadcast loses the race (atomic claim guard)', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockImplementation((query: any) =>
        Promise.resolve(query.name === 'ZCHF' ? zchfTxAsset : realuTxAsset),
      );
      evmClient.sendSignedTransaction.mockResolvedValue({ response: { hash: '0xSwapTxHash' } });
      transactionRequestService.claimForBroadcast.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const first = await service.broadcastSwapTransaction(42, 1, broadcastDto);
      expect(first.txHash).toBe('0xSwapTxHash');

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(
        new ConflictException('Transaction request is already confirmed'),
      );
      expect(evmClient.sendSignedTransaction).toHaveBeenCalledTimes(1);
    });

    it('releases the broadcast claim when sendSignedTransaction returns an error', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);
      transactionRequestService.claimForBroadcast.mockResolvedValue(true);
      evmClient.sendSignedTransaction.mockResolvedValue({ error: { message: 'nonce too low' } });

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(transactionRequestService.releaseBroadcastClaim).toHaveBeenCalledWith(mockRequest.id);
      expect(transactionRequestService.complete).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the signed swap tx targets an unexpected contract/calldata', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      const badUnsignedTx = ethers.utils.serializeTransaction({
        type: 2,
        chainId: 11155111,
        nonce: 7,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(350_000),
        to: '0x000000000000000000000000000000000000dEaD', // wrong recipient contract
        value: ethers.BigNumber.from(0),
        data: '0x12345678',
        accessList: [],
      });

      await expect(
        service.broadcastSwapTransaction(42, 1, { ...broadcastDto, unsignedTx: badUnsignedTx }),
      ).rejects.toThrow(BadRequestException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the signed swap tx has correct to/chainId/value but mismatched calldata', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      // Correct to/chainId/value, but different transferAndCall amount so expectedData mismatches
      const mismatchedData = erc677Interface.encodeFunctionData('transferAndCall', [
        '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        ethers.BigNumber.from(99), // wrong shares amount vs mockRequest.amount = 10
        '0x',
      ]);
      const mismatchedCalldataTx = ethers.utils.serializeTransaction({
        type: 2,
        chainId: 11155111,
        nonce: 7,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(350_000),
        to: realuContract,
        value: ethers.BigNumber.from(0),
        data: mismatchedData,
        accessList: [],
      });

      await expect(
        service.broadcastSwapTransaction(42, 1, { ...broadcastDto, unsignedTx: mismatchedCalldataTx }),
      ).rejects.toThrow(BadRequestException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('throws BadRequestException (not a raw 500) when unsignedTx is syntactically malformed', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      await expect(
        service.broadcastSwapTransaction(42, 1, { ...broadcastDto, unsignedTx: '0xdeadbeef' }),
      ).rejects.toThrow(BadRequestException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('maps a signed transaction parse failure to BadRequestException', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      const parseTransaction = ethers.utils.parseTransaction;
      const parseTransactionSpy = jest.spyOn(ethers.utils, 'parseTransaction');
      parseTransactionSpy
        .mockImplementationOnce((rawTransaction) => parseTransaction(rawTransaction))
        .mockImplementationOnce(() => {
          throw new Error('invalid signature');
        });

      try {
        await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(
          'Invalid signed transaction',
        );
        expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
      } finally {
        parseTransactionSpy.mockRestore();
      }
    });

    it('throws BadRequestException when the signed swap tx sender does not match the request user address (foreign wallet)', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      const foreignWallet = new ethers.Wallet('0x' + '22'.repeat(32));
      const foreignSignedTx = await foreignWallet.signTransaction(txFields);
      const { r, s, v } = ethers.utils.parseTransaction(foreignSignedTx);

      await expect(service.broadcastSwapTransaction(42, 1, { unsignedTx, r, s, v })).rejects.toThrow(
        BadRequestException,
      );
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the REALU asset is not found', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(undefined as any).mockResolvedValueOnce(zchfTxAsset);

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(NotFoundException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the ZCHF asset is not found', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(undefined as any);

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(NotFoundException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('throws the specific "Invalid unsigned transaction" fee-field-guard failure (not merely a generic BadRequestException) when unsignedTx is a legacy type-0 tx without EIP-1559 fee fields', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValueOnce(realuTxAsset).mockResolvedValueOnce(zchfTxAsset);

      // Legacy type-0 uses gasPrice only — parseTransaction yields undefined maxFeePerGas/maxPriorityFeePerGas,
      // which trips the fee-field guard inside reconstructSignedTransaction BEFORE the downstream
      // payload/sender-match check ever runs. That guard's own Error message is caught by
      // reconstructSignedTransaction's catch-all and remapped to 'Invalid unsigned transaction' — so THAT is
      // the specific, discriminating signal to assert on here.
      // Proof this is sharp, not incidental: reusing broadcastDto's r/s/v (a valid signature for the ORIGINAL
      // type-2 payload) against this legacy payload means that if the fee-field guard did NOT fire first,
      // execution would fall through to the payload/sender-match check and throw a DIFFERENT message
      // ('...does not match the expected request payload') instead — so the two failure modes are
      // distinguishable and this assertion cannot pass for the wrong reason.
      const legacyUnsignedTx = ethers.utils.serializeTransaction({
        type: 0,
        chainId: 11155111,
        nonce: 7,
        gasPrice: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(350_000),
        to: realuContract,
        value: ethers.BigNumber.from(0),
        data: swapData,
      });

      await expect(
        service.broadcastSwapTransaction(42, 1, { ...broadcastDto, unsignedTx: legacyUnsignedTx }),
      ).rejects.toThrow('Invalid unsigned transaction');
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });
  });

  // The engine-touching OCP specs run under PRD (→ Ethereum) to exercise the mainnet branch. A dedicated
  // block below asserts that on the LOC/Sepolia branch the method guard now PASSES (Sepolia is a supported
  // payment-link EVM method on non-PRD), so the OCP pay flow is testable end-to-end on the testnet.
  describe('createOcpPayUnsignedTransaction', () => {
    const amountWei = '5000000000000000000';

    beforeAll(() => {
      mockEnvironment = 'prd';
    });

    afterAll(() => {
      mockEnvironment = 'loc';
    });

    beforeEach(() => {
      evmClient.getTransactionCount.mockResolvedValue(3);
      evmClient.getRecommendedGasPrice.mockResolvedValue(ethers.BigNumber.from(1_000_000_000));
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);
    });

    it('should activate the quote, parse the EVM uri and build the ZCHF transfer tx', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.ETHEREUM,
        uri: `ethereum:${zchfTxAsset.chainId}@1/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });

      const result = await service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz');

      expect(lnUrlForwardService.lnurlpCallbackForward).toHaveBeenCalledWith('pl_abc', {
        method: Blockchain.ETHEREUM,
        asset: 'ZCHF',
        quote: 'quote_xyz',
      });
      expect(result.recipient).toBe(dfxDepositAddress);
      expect(result.amountWei).toBe(amountWei);
      expect(result.tokenAddress).toBe(zchfTxAsset.chainId);

      const parsed = ethers.utils.parseTransaction(result.unsignedTx);
      expect(parsed.to?.toLowerCase()).toBe(zchfTxAsset.chainId.toLowerCase());
      expect(parsed.nonce).toBe(3);
    });

    it('should derive the pay-tx nonce from the pending block tag (avoids collision with a still-pending swap tx)', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.SEPOLIA,
        uri: `ethereum:${zchfTxAsset.chainId}@11155111/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });

      await service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz');

      expect(evmClient.getTransactionCount).toHaveBeenCalledWith(userAddress, 'pending');
    });

    it('should throw BadRequestException if the EVM uri token contract does not match the ZCHF asset', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.SEPOLIA,
        uri: `ethereum:${realuContract}@11155111/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if the EVM uri amount is malformed', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.SEPOLIA,
        uri: `ethereum:${zchfTxAsset.chainId}@11155111/transfer?address=${dfxDepositAddress}&uint256=not-a-number`,
        hint: '',
      });

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if the EVM uri recipient is not a valid address', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.SEPOLIA,
        uri: `ethereum:${zchfTxAsset.chainId}@11155111/transfer?address=0xNotAnAddress&uint256=${amountWei}`,
        hint: '',
      });

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if the quote returns no EVM payment request', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({ pr: 'lnbc...' } as any);

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if the EVM uri is missing recipient or amount', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.SEPOLIA,
        uri: `ethereum:${zchfTxAsset.chainId}@11155111/transfer?address=${dfxDepositAddress}`,
        hint: '',
      });

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if the ZCHF asset has no contract address', async () => {
      assetService.getAssetByQuery.mockResolvedValue(createCustomAsset({ name: 'ZCHF', chainId: undefined } as any));

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
      expect(lnUrlForwardService.lnurlpCallbackForward).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if ETH balance is insufficient for gas', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.ETHEREUM,
        uri: `ethereum:${zchfTxAsset.chainId}@1/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(0);

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw ConflictException if ZCHF balance is insufficient (swap not yet settled)', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.ETHEREUM,
        uri: `ethereum:${zchfTxAsset.chainId}@1/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });
      evmClient.getTokenBalanceWei.mockResolvedValueOnce(ethers.BigNumber.from(0));

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should reject a wallet whose ETH balance covers the base gas cost but not the buffered maxFeePerGas (F5)', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.ETHEREUM,
        uri: `ethereum:${zchfTxAsset.chainId}@1/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });
      // gasPrice=1e9, gasLimit=100_000 -> base requirement 0.0001 ETH, buffered (x1.2) requirement 0.00012 ETH
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(0.00011);

      await expect(service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should build the pay tx when ETH balance is just above the buffered maxFeePerGas requirement (F5) and the tx carries the buffered fee', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.ETHEREUM,
        uri: `ethereum:${zchfTxAsset.chainId}@1/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });
      // gasPrice=1e9, gasLimit=100_000 -> buffered (x1.2) requirement 0.00012 ETH; use a balance just above it
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(0.000121);

      const result = await service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz');

      const parsed = ethers.utils.parseTransaction(result.unsignedTx);
      const expectedBufferedMaxFeePerGas = ethers.BigNumber.from(1_000_000_000).mul(120).div(100);
      expect(parsed.maxFeePerGas?.toString()).toBe(expectedBufferedMaxFeePerGas.toString());
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

  describe('submitOcpPay', () => {
    beforeAll(() => {
      mockEnvironment = 'prd';
    });

    afterAll(() => {
      mockEnvironment = 'loc';
    });

    it('should reconstruct the signed hex and forward it into the lnurlp tx path', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.txHexForward.mockResolvedValue({ txId: '0xTxId' });

      const signerWallet = new ethers.Wallet('0x' + '11'.repeat(32));
      const payAmountWei = ethers.BigNumber.from('5000000000000000000');
      const txFields = {
        type: 2,
        chainId: 1,
        nonce: 1,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(100_000),
        to: zchfTxAsset.chainId,
        value: ethers.BigNumber.from(0),
        data: EvmUtil.encodeErc20Transfer(dfxDepositAddress, payAmountWei),
        accessList: [],
      };
      const unsignedTx = ethers.utils.serializeTransaction(txFields);
      const fullySignedTx = await signerWallet.signTransaction(txFields);
      const { r, s, v } = ethers.utils.parseTransaction(fullySignedTx);

      const result = await service.submitOcpPay({
        paymentLinkId: 'pl_abc',
        quoteId: 'quote_xyz',
        unsignedTx,
        r,
        s,
        v,
      });

      expect(result.txId).toBe('0xTxId');
      expect(lnUrlForwardService.txHexForward).toHaveBeenCalledWith(
        'pl_abc',
        expect.objectContaining({ method: Blockchain.ETHEREUM, asset: 'ZCHF', quote: 'quote_xyz' }),
      );
      expect(lnUrlForwardService.txHexForward.mock.calls[0][1].hex).toMatch(/^0x/);
    });

    it('should throw BadRequestException (not a raw 500) when the signed tx data is not a valid ERC-20 transfer', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);

      const signerWallet = new ethers.Wallet('0x' + '11'.repeat(32));
      const txFields = {
        type: 2,
        chainId: 1,
        nonce: 1,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(100_000),
        to: zchfTxAsset.chainId,
        value: ethers.BigNumber.from(0),
        data: '0x12345678', // garbage selector — not the ERC-20 transfer() selector
        accessList: [],
      };
      const unsignedTx = ethers.utils.serializeTransaction(txFields);
      const fullySignedTx = await signerWallet.signTransaction(txFields);
      const { r, s, v } = ethers.utils.parseTransaction(fullySignedTx);

      await expect(
        service.submitOcpPay({ paymentLinkId: 'pl_abc', quoteId: 'quote_xyz', unsignedTx, r, s, v }),
      ).rejects.toThrow(BadRequestException);
      expect(lnUrlForwardService.txHexForward).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException if the ZCHF asset is not found', async () => {
      assetService.getAssetByQuery.mockResolvedValue(undefined as any);

      await expect(
        service.submitOcpPay({
          paymentLinkId: 'pl_abc',
          quoteId: 'quote_xyz',
          unsignedTx: '0x',
          r: '0x',
          s: '0x',
          v: 27,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(lnUrlForwardService.txHexForward).not.toHaveBeenCalled();
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
      return {
        id: 42,
        address: senderAddress,
        userData: {
          kycLevel,
        },
      };
    }

    function mockTransferAssets(): void {
      assetService.getAssetByQuery.mockImplementation(async (q: any) =>
        q.name === 'REALU' ? transferRealuAsset : transferZchfAsset,
      );
    }

    beforeEach(() => {
      // Registration is async (aktionariat_registration) on develop — spy the gate directly.
      jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(true);
      // reset mutable W2W gas-wallet config to the funded defaults
      mockW2wGasWalletPrivateKey = mockW2wGasWalletKeyDefault;
      mockW2wGasWalletAddress = mockW2wGasWalletAddressDerived;
      sepoliaClient.getTokenBalance.mockResolvedValue(999);
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
        jest.spyOn(service, 'hasRegistrationForWallet').mockResolvedValue(false);
        const user = buildRegisteredUser(30);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toBeInstanceOf(
          RegistrationRequiredException,
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('throws when KYC level is below 30', async () => {
        const user = buildRegisteredUser(20);

        await expect(service.prepareTransfer(user, { toAddress: recipientAddress, amount: 1 })).rejects.toBeInstanceOf(
          KycLevelRequiredException,
        );
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
          delegate: mockW2wGasWalletAddressDerived,
          authority: '0xRoot',
          salt: '1',
          signature: '0xSig',
        },
        authorization: { chainId: 11155111, address: '0xDelegator', nonce: 0, r: '0xR', s: '0xS', yParity: 0 },
      };

      function buildStoredRequest(overrides: any = {}): any {
        const request: any = {
          id: 99,
          uid: 'RTabc',
          toAddress: recipientAddress,
          amount: 5,
          status: RealUnitTransferRequestStatus.CREATED,
          user: { id: 42, address: senderAddress, userData: {} },
          complete: jest.fn(function (this: any, txHash: string) {
            this.status = RealUnitTransferRequestStatus.COMPLETED;
            this.txHash = txHash;
            return this;
          }),
          fail: jest.fn(function (this: any) {
            this.status = RealUnitTransferRequestStatus.FAILED;
            return this;
          }),
          ...overrides,
        };
        Object.defineProperty(request, 'isComplete', {
          get() {
            return request.status === RealUnitTransferRequestStatus.COMPLETED;
          },
          configurable: true,
        });
        return request;
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
          expect.any(Function), // onBroadcast callback that persists txHash before the receipt wait
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

      it('returns the stored txHash immediately for an already-completed request, without any balance/relay calls', async () => {
        transferRequestRepo.findOne.mockResolvedValue(
          buildStoredRequest({ status: RealUnitTransferRequestStatus.COMPLETED, txHash: w2wTxHash }),
        );

        const result = await service.confirmTransfer(42, 99, confirmDto);

        expect(result.txHash).toBe(w2wTxHash);
        expect(assetService.getAssetByQuery).not.toHaveBeenCalled();
        expect(sepoliaClient.getTokenBalance).not.toHaveBeenCalled();
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws BadRequest when the delegator does not match the request owner', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);

        const wrongDto = { ...confirmDto, delegation: { ...confirmDto.delegation, delegator: '0xWrong' } };

        await expect(service.confirmTransfer(42, 99, wrongDto)).rejects.toThrow(BadRequestException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws BadRequest when the delegate does not match the W2W gas wallet', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        sepoliaClient.getTokenBalance.mockResolvedValue(999);

        const wrongDto = { ...confirmDto, delegation: { ...confirmDto.delegation, delegate: '0xWrongDelegate' } };

        await expect(service.confirmTransfer(42, 99, wrongDto)).rejects.toThrow(BadRequestException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws BadRequest when the sender does not hold enough REALU', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        sepoliaClient.getTokenBalance.mockResolvedValue(4); // stored request amount is 5

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(BadRequestException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });

      it('throws when the configured W2W gas wallet address does not match the key-derived address', async () => {
        transferRequestRepo.findOne.mockResolvedValue(buildStoredRequest());
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        mockW2wGasWalletAddress = '0xSomeOtherAddressThatDoesNotMatch';

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(
          'REALUNIT_W2W_GAS_WALLET_ADDRESS does not match the address derived from REALUNIT_W2W_GAS_WALLET_PRIVATE_KEY',
        );
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
          expect.any(Function),
        );
      });

      it('is idempotent: a second confirm on an already-broadcast request returns the same txHash without relaying again or re-checking balance', async () => {
        const storedRequest = buildStoredRequest();
        transferRequestRepo.findOne.mockResolvedValue(storedRequest);
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        eip7702DelegationService.transferTokenWithUserDelegation.mockImplementation(async (...args: any[]) => {
          const onBroadcast = args[args.length - 1];
          if (typeof onBroadcast === 'function') await onBroadcast(w2wTxHash);
          return w2wTxHash;
        });

        const firstResult = await service.confirmTransfer(42, 99, confirmDto);
        expect(firstResult.txHash).toBe(w2wTxHash);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).toHaveBeenCalledTimes(1);
        expect(sepoliaClient.getTokenBalance).toHaveBeenCalledTimes(1);

        // Model the persisted state after the first call: the onBroadcast callback already persisted
        // txHash via transferRequestRepo.update before the receipt wait, and the request completed.
        storedRequest.txHash = w2wTxHash;
        storedRequest.status = RealUnitTransferRequestStatus.COMPLETED;

        // Drain the balance to below the transfer amount, as a real successful transfer would leave it —
        // proves the retry short-circuits BEFORE the balance check (the old, buggy code would 409 here
        // instead of returning the hash, because 0 < amount).
        sepoliaClient.getTokenBalance.mockResolvedValue(0);

        const secondResult = await service.confirmTransfer(42, 99, confirmDto);

        expect(secondResult.txHash).toBe(w2wTxHash);
        // still 1 — the second call short-circuits on the idempotency shortcut, no second relay
        expect(eip7702DelegationService.transferTokenWithUserDelegation).toHaveBeenCalledTimes(1);
        // still 1 — the shortcut returns before the balance check is ever reached again
        expect(sepoliaClient.getTokenBalance).toHaveBeenCalledTimes(1);
      });

      it('marks the request FAILED when the relay reverts on-chain, and a retry does not return the reverted hash as success', async () => {
        const storedRequest = buildStoredRequest();
        transferRequestRepo.findOne.mockResolvedValueOnce(storedRequest);
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        eip7702DelegationService.transferTokenWithUserDelegation.mockImplementation(async (...args: any[]) => {
          const onBroadcast = args[args.length - 1];
          if (typeof onBroadcast === 'function') await onBroadcast(w2wTxHash);
          throw new TransactionRevertedException(w2wTxHash);
        });

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(TransactionRevertedException);

        expect(transferRequestRepo.update).toHaveBeenCalledWith(99, {
          status: RealUnitTransferRequestStatus.FAILED,
        });

        // Retry after the revert: model the persisted FAILED+txHash state. The idempotency shortcut
        // excludes FAILED, so this falls through into the atomic claim (WHERE status=CREATED), which
        // matches nothing -> Conflict, instead of returning the reverted hash as a false success.
        transferRequestRepo.findOne.mockResolvedValueOnce({
          ...storedRequest,
          txHash: w2wTxHash,
          status: RealUnitTransferRequestStatus.FAILED,
        });
        transferRequestRepo.update.mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] });

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(ConflictException);
      });

      it('throws Conflict when the request is stuck in PROCESSING without a txHash (no retry after a non-terminal state)', async () => {
        transferRequestRepo.findOne.mockResolvedValue(
          buildStoredRequest({ status: RealUnitTransferRequestStatus.PROCESSING }),
        );
        assetService.getAssetByQuery.mockResolvedValue(transferRealuAsset);
        transferRequestRepo.update.mockResolvedValueOnce({ affected: 0, raw: [], generatedMaps: [] }); // WHERE status=CREATED matches nothing

        await expect(service.confirmTransfer(42, 99, confirmDto)).rejects.toThrow(ConflictException);
        expect(eip7702DelegationService.transferTokenWithUserDelegation).not.toHaveBeenCalled();
      });
    });

    describe('reconcilePendingTransfers', () => {
      function buildStaleTransferRequest(overrides: any = {}): any {
        return {
          id: 1,
          uid: 'RTstale',
          toAddress: '0x0000000000000000000000000000000000dEaD',
          amount: 1,
          status: RealUnitTransferRequestStatus.PROCESSING,
          user: { id: 1 },
          txHash: null,
          ...overrides,
        };
      }

      it('marks a stale PROCESSING request with no txHash FAILED via conditional update (not save)', async () => {
        transferRequestRepo.find.mockResolvedValue([buildStaleTransferRequest({ id: 5, txHash: null })]);
        transferRequestRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

        await service.reconcilePendingTransfers();

        expect(transferRequestRepo.update).toHaveBeenCalledWith(
          { id: 5, status: RealUnitTransferRequestStatus.PROCESSING, txHash: IsNull() },
          { status: RealUnitTransferRequestStatus.FAILED },
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('does not mark FAILED when a concurrent broadcast already set txHash (affected=0 skip)', async () => {
        transferRequestRepo.find.mockResolvedValue([buildStaleTransferRequest({ id: 6, txHash: null })]);
        transferRequestRepo.update.mockResolvedValue({ affected: 0, raw: [], generatedMaps: [] });

        await service.reconcilePendingTransfers();

        expect(transferRequestRepo.update).toHaveBeenCalledTimes(1);
        expect(transferRequestRepo.update).toHaveBeenCalledWith(
          { id: 6, status: RealUnitTransferRequestStatus.PROCESSING, txHash: IsNull() },
          { status: RealUnitTransferRequestStatus.FAILED },
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
        // No second corrective update — silent skip when affected=0
        expect(transferRequestRepo.update).toHaveBeenCalledTimes(1);
      });

      it('marks COMPLETED via conditional update when on-chain receipt status is 1', async () => {
        transferRequestRepo.find.mockResolvedValue([buildStaleTransferRequest({ id: 7, txHash: '0xabc' })]);
        sepoliaClient.getTxReceipt.mockResolvedValue({ status: 1 });
        transferRequestRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

        await service.reconcilePendingTransfers();

        expect(sepoliaClient.getTxReceipt).toHaveBeenCalledWith('0xabc');
        expect(transferRequestRepo.update).toHaveBeenCalledWith(
          { id: 7, status: RealUnitTransferRequestStatus.PROCESSING },
          { status: RealUnitTransferRequestStatus.COMPLETED, txHash: '0xabc' },
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });

      it('marks FAILED via conditional update when on-chain receipt is reverted (status !== 1)', async () => {
        transferRequestRepo.find.mockResolvedValue([buildStaleTransferRequest({ id: 8, txHash: '0xdef' })]);
        sepoliaClient.getTxReceipt.mockResolvedValue({ status: 0 });
        transferRequestRepo.update.mockResolvedValue({ affected: 1, raw: [], generatedMaps: [] });

        await service.reconcilePendingTransfers();

        expect(sepoliaClient.getTxReceipt).toHaveBeenCalledWith('0xdef');
        expect(transferRequestRepo.update).toHaveBeenCalledWith(
          { id: 8, status: RealUnitTransferRequestStatus.PROCESSING },
          { status: RealUnitTransferRequestStatus.FAILED },
        );
        expect(transferRequestRepo.save).not.toHaveBeenCalled();
      });
    });
  });

  describe('getOcpPayStatus', () => {
    it('should map the most recent payment status', async () => {
      paymentLinkPaymentService.getMostRecentPayment.mockResolvedValue({
        status: PaymentLinkPaymentStatus.COMPLETED,
      } as any);

      const result = await service.getOcpPayStatus('pl_abc');

      expect(result).toEqual({ status: PaymentLinkPaymentStatus.COMPLETED });
      expect(paymentLinkPaymentService.getMostRecentPayment).toHaveBeenCalledWith('pl_abc');
    });
  });

  describe('assertPaymentLinkSupportsMethod (private guard)', () => {
    it('throws ServiceUnavailableException (not BadRequestException) for an unsupported token blockchain', () => {
      jest.spyOn(service as any, 'tokenBlockchain', 'get').mockReturnValue(Blockchain.BITCOIN);

      expect(() =>
        (service as unknown as { assertPaymentLinkSupportsMethod: () => void }).assertPaymentLinkSupportsMethod(),
      ).toThrow(ServiceUnavailableException);

      expect(() =>
        (service as unknown as { assertPaymentLinkSupportsMethod: () => void }).assertPaymentLinkSupportsMethod(),
      ).not.toThrow(BadRequestException);
    });
  });

  // On LOC/DEV the token blockchain resolves to Sepolia. Sepolia is a supported payment-link EVM method on
  // non-PRD, so the method guard passes and both OCP pay endpoints proceed into the payment-link engine
  // (OCP is testable end-to-end on the testnet).
  describe('OCP pay supported on non-PRD testnet (Sepolia)', () => {
    const amountWei = '5000000000000000000';

    beforeEach(() => {
      evmClient.getTransactionCount.mockResolvedValue(3);
      evmClient.getRecommendedGasPrice.mockResolvedValue(ethers.BigNumber.from(1_000_000_000));
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);
    });

    it('createOcpPayUnsignedTransaction passes the method guard and activates the Sepolia quote', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.lnurlpCallbackForward.mockResolvedValue({
        expiryDate: new Date(),
        blockchain: Blockchain.SEPOLIA,
        uri: `ethereum:${zchfTxAsset.chainId}@11155111/transfer?address=${dfxDepositAddress}&uint256=${amountWei}`,
        hint: '',
      });

      const result = await service.createOcpPayUnsignedTransaction(userAddress, 'pl_abc', 'quote_xyz');

      expect(lnUrlForwardService.lnurlpCallbackForward).toHaveBeenCalledWith('pl_abc', {
        method: Blockchain.SEPOLIA,
        asset: 'ZCHF',
        quote: 'quote_xyz',
      });
      expect(result.recipient).toBe(dfxDepositAddress);
      expect(result.amountWei).toBe(amountWei);
    });

    it('submitOcpPay passes the method guard and forwards the hex with the Sepolia method', async () => {
      assetService.getAssetByQuery.mockResolvedValue(zchfTxAsset);
      lnUrlForwardService.txHexForward.mockResolvedValue({ txId: '0xTxId' });

      const signerWallet = new ethers.Wallet('0x' + '11'.repeat(32));
      const payAmountWei = ethers.BigNumber.from('5000000000000000000');
      const txFields = {
        type: 2,
        chainId: 11155111,
        nonce: 1,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(100_000),
        to: zchfTxAsset.chainId,
        value: ethers.BigNumber.from(0),
        data: EvmUtil.encodeErc20Transfer(dfxDepositAddress, payAmountWei),
        accessList: [],
      };
      const unsignedTx = ethers.utils.serializeTransaction(txFields);
      const fullySignedTx = await signerWallet.signTransaction(txFields);
      const { r, s, v } = ethers.utils.parseTransaction(fullySignedTx);

      const result = await service.submitOcpPay({
        paymentLinkId: 'pl_abc',
        quoteId: 'quote_xyz',
        unsignedTx,
        r,
        s,
        v,
      });

      expect(result.txId).toBe('0xTxId');
      expect(lnUrlForwardService.txHexForward).toHaveBeenCalledWith(
        'pl_abc',
        expect.objectContaining({ method: Blockchain.SEPOLIA, asset: 'ZCHF', quote: 'quote_xyz' }),
      );
    });
  });

  describe('completeRegistrationForWalletAddress (idempotency)', () => {
    const walletAddress = '0x1111111111111111111111111111111111111111';
    const userDataId = 42;
    const matchingSignature = '0xSIGNATURE_MATCHING';
    // Server-truth "today" (UTC): the add-wallet path now validates the signed
    // registrationDate the same way register/complete does.
    const registrationDate = new Date().toISOString().split('T')[0];

    function buildRegistration(opts: { signature: string; status: ReviewStatus }): any {
      return {
        id: 1,
        signature: opts.signature,
        status: opts.status,
        walletAddress: walletAddress.toLowerCase(),
      };
    }

    // findRegistration's first lookup (current wallet) returns the active row for this address.
    function mockCurrentWalletRegistration(registration: any): void {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(registration);
    }

    const dto = {
      walletAddress,
      signature: matchingSignature,
      registrationDate,
    };

    it('returns ALREADY_REGISTERED without persisting a new registration when signature matches a completed registration', async () => {
      mockCurrentWalletRegistration(
        buildRegistration({ signature: matchingSignature, status: ReviewStatus.COMPLETED }),
      );

      const status = await service.completeRegistrationForWalletAddress(userDataId, dto);

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
      expect(aktionariatRegistrationRepo.save).not.toHaveBeenCalled();
    });

    it('returns FORWARDING_FAILED when signature matches but the existing registration is not completed', async () => {
      mockCurrentWalletRegistration(
        buildRegistration({ signature: matchingSignature, status: ReviewStatus.MANUAL_REVIEW }),
      );

      const status = await service.completeRegistrationForWalletAddress(userDataId, dto);

      expect(status).toBe(RealUnitRegistrationStatus.FORWARDING_FAILED);
      expect(aktionariatRegistrationRepo.save).not.toHaveBeenCalled();
    });

    it('matches signatures case-insensitively (stored upper-case, incoming lower-case)', async () => {
      mockCurrentWalletRegistration(
        buildRegistration({ signature: matchingSignature.toUpperCase(), status: ReviewStatus.COMPLETED }),
      );

      const status = await service.completeRegistrationForWalletAddress(userDataId, {
        ...dto,
        signature: matchingSignature.toLowerCase(),
      });

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
    });

    it('throws BadRequestException when an existing registration for the same wallet has a different signature', async () => {
      mockCurrentWalletRegistration(
        buildRegistration({ signature: '0xDIFFERENT_SIGNATURE', status: ReviewStatus.COMPLETED }),
      );

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the wallet does not belong to any user', async () => {
      userService.getUserByAddress.mockResolvedValue(undefined as any);

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the wallet belongs to a different account', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: 999 } } as any);

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no registration exists to derive the wallet from', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      // both findRegistration lookups (current + other wallet) resolve to nothing
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the derived registration has no signed payload', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      // current-wallet miss, other-wallet hit but with no reconstructable payload
      aktionariatRegistrationRepo.findOne
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ id: 2, status: ReviewStatus.COMPLETED, signedPayloadData: undefined } as any);

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(BadRequestException);
    });

    it('reconstructs a prior registration and forwards it for the new wallet (add-wallet), returning COMPLETED', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        id: 2,
        status: ReviewStatus.COMPLETED,
        signedPayloadData: {
          email: 'e@example.com',
          name: 'Name',
          walletAddress: '0xother',
          signature: '0xold',
          registrationDate: '2026-01-01',
        },
        kycDataObj: { accountType: 'Personal' },
      } as any);
      jest.spyOn(service as any, 'verifyRealUnitRegistrationSignature').mockReturnValue(true);
      const forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);

      const status = await service.completeRegistrationForWalletAddress(userDataId, dto);

      expect(status).toBe(RealUnitRegistrationStatus.COMPLETED);
      // the re-forward carries the NEW wallet/signature/date over the reconstructed account data
      expect(forwardSpy).toHaveBeenCalledWith(
        { id: userDataId },
        expect.objectContaining({ walletAddress, signature: matchingSignature, registrationDate }),
      );
    });

    it('returns FORWARDING_FAILED when the re-forward for the new wallet fails', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        id: 2,
        status: ReviewStatus.COMPLETED,
        signedPayloadData: { walletAddress: '0xother', signature: '0xold', registrationDate: '2026-01-01' },
        kycDataObj: { accountType: 'Personal' },
      } as any);
      jest.spyOn(service as any, 'verifyRealUnitRegistrationSignature').mockReturnValue(true);
      jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(false);

      const status = await service.completeRegistrationForWalletAddress(userDataId, dto);

      expect(status).toBe(RealUnitRegistrationStatus.FORWARDING_FAILED);
    });

    it('throws BadRequestException when the derived signature is invalid for the new wallet', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        id: 2,
        status: ReviewStatus.COMPLETED,
        signedPayloadData: { walletAddress: '0xother', signature: '0xold', registrationDate: '2026-01-01' },
        kycDataObj: undefined,
      } as any);
      jest.spyOn(service as any, 'verifyRealUnitRegistrationSignature').mockReturnValue(false);

      await expect(service.completeRegistrationForWalletAddress(userDataId, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the add-wallet registration date is stale (older than yesterday)', async () => {
      userService.getUserByAddress.mockResolvedValue({ userData: { id: userDataId } } as any);
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
        id: 2,
        status: ReviewStatus.COMPLETED,
        signedPayloadData: { walletAddress: '0xother', signature: '0xold', registrationDate: '2026-01-01' },
        kycDataObj: { accountType: 'Personal' },
      } as any);
      // Signature passes; the stale date must still be rejected symmetrically.
      jest.spyOn(service as any, 'verifyRealUnitRegistrationSignature').mockReturnValue(true);
      const forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);

      await expect(
        service.completeRegistrationForWalletAddress(userDataId, { ...dto, registrationDate: '2020-01-01' }),
      ).rejects.toThrow(BadRequestException);
      expect(forwardSpy).not.toHaveBeenCalled();
    });
  });

  describe('getRegistrationDate', () => {
    it("returns the server's current date (UTC) in yyyy-mm-dd format", () => {
      const expected = new Date().toISOString().split('T')[0];
      expect(service.getRegistrationDate()).toEqual({ date: expected });
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
      };
    }

    function buildRegistrationForWallet(
      registrationWalletAddress: string,
      opts: { status?: ReviewStatus; requiresEmailConfirmation?: boolean; confirmedDate?: Date } = {},
    ): any {
      return {
        id: 1,
        status: opts.status ?? ReviewStatus.COMPLETED,
        // the queryable column is canonically lowercased
        walletAddress: registrationWalletAddress.toLowerCase(),
        requiresEmailConfirmation: opts.requiresEmailConfirmation ?? true,
        // the confirmed state is a first-confirmation latch ON the registration row (single source of truth)
        confirmedDate: opts.confirmedDate,
        // findRegistration/toRegistrationDto read the parsed getters directly off the entity
        signedPayloadData: {
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
          walletAddress: registrationWalletAddress,
          registrationDate: '2026-05-21',
        },
        kycDataObj: { accountType: 'Personal', firstName: 'Signed', lastName: 'Name' },
      };
    }

    it('returns state=ALREADY_REGISTERED when an active registration for the current wallet exists', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(buildRegistrationForWallet(walletAddress));

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.ALREADY_REGISTERED);
      expect(status.isRegistered).toBe(true);
      expect(status.userData).toBeDefined();
      expect(status.userData!.email).toBe('signed@example.com');
      expect(status.userData!.name).toBe('Signed Name');
      // ADD_WALLET pre-fill carries the stored kycData
      expect(status.userData!.kycData.firstName).toBe('Signed');
    });

    it('returns state=ADD_WALLET when a completed registration exists for a different wallet but not the current one', async () => {
      const userData = buildVerifiedUserData();
      // current-wallet lookup misses, other-wallet lookup hits
      aktionariatRegistrationRepo.findOne
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(buildRegistrationForWallet(otherWalletAddress));

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.ADD_WALLET);
      expect(status.isRegistered).toBe(false);
      expect(status.userData).toBeDefined();
      // userData comes from the existing signed registration, not from KYC fallback
      expect(status.userData!.email).toBe('signed@example.com');
      expect(status.userData!.name).toBe('Signed Name');
    });

    it('returns state=NEW_REGISTRATION when no registration exists but userData has firstname/surname', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      const status = await service.getRegistrationInfo(userData, walletAddress);

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

    it('returns state=NEW_REGISTRATION with no userData when no registration exists and no KYC data is present (first-time user gets an empty form)', async () => {
      const userData = {
        id: 1,
        firstname: null,
        surname: null,
      } as any;
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.isRegistered).toBe(false);
      expect(status.userData).toBeUndefined();
    });

    it('defaults swissTaxResidence to false in NEW_REGISTRATION when the residence country is not CH', async () => {
      const userData = buildVerifiedUserData();
      userData.country = { id: 2, symbol: 'DE' };
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.userData!.swissTaxResidence).toBe(false);
      expect(status.userData!.addressCountry).toBe('DE');
    });

    it('falls back to EN in NEW_REGISTRATION when the user language is not one of the RealUnit-supported codes', async () => {
      const userData = buildVerifiedUserData();
      userData.language = { symbol: 'ES' };
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.userData!.lang).toBe('EN');
    });

    it('reports emailConfirmed=true and the confirmedDate when the registration carries a confirmedDate latch', async () => {
      const userData = buildVerifiedUserData();
      const confirmedDate = new Date('2026-06-01T00:00:00.000Z');
      // the confirmed state is read straight off the registration row (no separate table, no join)
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(
        buildRegistrationForWallet(walletAddress, { requiresEmailConfirmation: true, confirmedDate }),
      );

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.emailConfirmed).toBe(true);
      expect(status.confirmedDate).toBe(confirmedDate);
    });

    it('reports emailConfirmed=true with no confirmedDate for a grandfathered registration (requiresEmailConfirmation=false)', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(
        buildRegistrationForWallet(walletAddress, { requiresEmailConfirmation: false }),
      );

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.emailConfirmed).toBe(true);
      expect(status.confirmedDate).toBeUndefined();
    });

    it('reports emailConfirmed=false for a new registration still awaiting confirmation (no latch, gate on)', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(
        buildRegistrationForWallet(walletAddress, { requiresEmailConfirmation: true }),
      );

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.emailConfirmed).toBe(false);
      expect(status.confirmedDate).toBeUndefined();
    });

    it('omits emailConfirmed/confirmedDate when the wallet is not registered', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.emailConfirmed).toBeUndefined();
      expect(status.confirmedDate).toBeUndefined();
    });

    it('reports manualReview=true for a current-wallet registration stuck in MANUAL_REVIEW (forward failed)', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(
        buildRegistrationForWallet(walletAddress, { status: ReviewStatus.MANUAL_REVIEW }),
      );

      const status = await service.getRegistrationInfo(userData, walletAddress);

      // state stays ALREADY_REGISTERED for backward compatibility; the new flag distinguishes the stuck case
      expect(status.state).toBe(RealUnitRegistrationState.ALREADY_REGISTERED);
      expect(status.manualReview).toBe(true);
    });

    it('reports manualReview=false for a COMPLETED current-wallet registration', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValueOnce(
        buildRegistrationForWallet(walletAddress, { status: ReviewStatus.COMPLETED }),
      );

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.ALREADY_REGISTERED);
      expect(status.manualReview).toBe(false);
    });

    it('omits manualReview for an ADD_WALLET (other-wallet) registration', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(buildRegistrationForWallet(otherWalletAddress, { status: ReviewStatus.COMPLETED }));

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.ADD_WALLET);
      expect(status.manualReview).toBeUndefined();
    });

    it('omits manualReview for a NEW_REGISTRATION (no registration row)', async () => {
      const userData = buildVerifiedUserData();
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      const status = await service.getRegistrationInfo(userData, walletAddress);

      expect(status.state).toBe(RealUnitRegistrationState.NEW_REGISTRATION);
      expect(status.manualReview).toBeUndefined();
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

  describe('isPersonalDataMatching (KYC prefill match gate)', () => {
    // fully aligned userData/dto pair (ASCII only, so transliteration is a no-op on both sides)
    const matchingUserData = (): any => ({
      firstname: 'Erika',
      surname: 'Mueller',
      phone: '+41790000000',
      accountType: 'Personal',
      street: 'Bahnhofstrasse',
      houseNumber: '1',
      location: 'Zurich',
      zip: '8001',
      country: { id: 10 },
      nationality: { symbol: 'CH' },
      birthday: new Date('1990-01-01T00:00:00.000Z'),
    });

    const matchingDto = (): any => ({
      nationality: 'CH',
      birthday: '1990-01-01',
      kycData: {
        firstName: 'Erika',
        lastName: 'Mueller',
        phone: '+41790000000',
        accountType: 'Personal',
        address: { street: 'Bahnhofstrasse', houseNumber: '1', city: 'Zurich', zip: '8001', country: { id: 10 } },
      },
    });

    it('returns true when every personal-data field (including the birthday) matches', () => {
      const ok = (service as any).isPersonalDataMatching(matchingUserData(), matchingDto());
      expect(ok).toBe(true);
    });

    it('returns false when only the birthday differs (last field checked)', () => {
      const dto = matchingDto();
      dto.birthday = '1991-02-02';
      const ok = (service as any).isPersonalDataMatching(matchingUserData(), dto);
      expect(ok).toBe(false);
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

    // forwardRegistration now operates on userData + dto (no KYC step); a high kycLevel skips the level-20 lift.
    const fakeUserData = (kycLevel = 999): any => ({ id: 1, kycLevel });

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
      // Registration resolves the exact wallet-user for the per-wallet AktionariatRegistration FK.
      userService.getUserByAddress.mockResolvedValue({ id: 1 } as any);
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

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

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

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

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

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

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

    it('persists the per-wallet registration and writes an INFO audit log on success', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 42 } as any);
      httpService.post.mockResolvedValue({ aktionariatId: 'ak-1' } as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      // the wallet relation is loaded for the (unused on success) forward-failure ticket source attribution
      expect(userService.getUserByAddress).toHaveBeenCalledWith(wallet, { wallet: true });

      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created).toMatchObject({
        user: { id: 42 },
        // queryable column is canonically lowercased for the exact-match confirm lookup
        walletAddress: wallet.toLowerCase(),
        email: dto.email,
        registrationDate: dto.registrationDate,
        signature: dto.signature,
        // success persists the row as COMPLETED (the single source of truth), no KYC step
        status: ReviewStatus.COMPLETED,
        active: true,
      });
      // a COMPLETED registration is gated on the Aktionariat confirmation mail
      expect(created.requiresEmailConfirmation).toBe(true);
      // success never opens a forward-failure support ticket
      expect(supportIssueService.createIssueInternal).not.toHaveBeenCalled();
      expect(created.forwardedToAktionariatDate).toBeInstanceOf(Date);
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      // the exact forwarded payload is attached for an idempotent re-forward and keeps the signed casing
      const saved = (aktionariatTxManager.save as jest.Mock).mock.calls[0][0];
      expect(saved.signedPayloadData.walletAddress).toBe(wallet);

      expect(logService.create).toHaveBeenCalledTimes(1);
      const log = (logService.create as jest.Mock).mock.calls[0][0];
      expect(log).toMatchObject({
        system: 'Aktionariat',
        subsystem: 'Registration',
        severity: LogSeverity.INFO,
        category: wallet,
      });
      const logMessage = JSON.parse(log.message);
      expect(logMessage.action).toBe('registerUser');
      // DB log is the DESIGNATED PII audit store: it now records the FULL sent payload (actual values),
      // not just the request field names
      expect(logMessage.request).toEqual(forwardedPayload());
      expect(logMessage.request.email).toBe(dto.email);
      expect(logMessage.request.name).toBe('Erika Müller');
      expect(logMessage.request.walletAddress).toBe(wallet);
      // and the FULL Aktionariat response body, not a field-name summary
      expect(logMessage.response).toEqual({ aktionariatId: 'ak-1' });

      // the forward is bounded (it runs inside the advisory-locked transaction)
      const postConfig = (httpService.post as jest.Mock).mock.calls[0][2];
      expect(postConfig.timeout).toBe(30000);
    });

    it('does not gate the completed registration on a confirmation mail when Aktionariat matched an existing shareholder', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      // Aktionariat updates an existing share-register shareholder in place and sends NO confirmation mail.
      httpService.post.mockResolvedValue({ message: 'Existing user found, updated your address.' } as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.status).toBe(ReviewStatus.COMPLETED);
      // no confirmation mail will ever arrive for an existing shareholder → must not be gated (else buy dead-ends)
      expect(created.requiresEmailConfirmation).toBe(false);
    });

    it('keeps the completed registration gated when Aktionariat sent a confirmation mail to a newly registered email', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({ message: 'Confirmation email sent to erika.example@example.com' } as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.status).toBe(ReviewStatus.COMPLETED);
      // a confirmation mail was sent → the row stays gated until the customer confirms
      expect(created.requiresEmailConfirmation).toBe(true);
    });

    it('keeps the registration gated when a confirmation mail echoes an address that merely embeds the marker words', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      // Aktionariat echoes the raw registrant email into the message; a quoted local part can embed the
      // marker words. The marker is matched start-anchored, so this stays a "Confirmation email sent" reply
      // and the row must stay gated — an embedded substring must not spoof an existing-shareholder match.
      httpService.post.mockResolvedValue({
        message: 'Confirmation email sent to "existing user found"@example.com',
      } as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.status).toBe(ReviewStatus.COMPLETED);
      expect(created.requiresEmailConfirmation).toBe(true);
    });

    it('persists the registration in DEV/LOC without calling Aktionariat and logs the response as skipped', async () => {
      mockEnvironment = 'loc';
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      expect(httpService.post).not.toHaveBeenCalled();
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.forwardedToAktionariatDate).toBeInstanceOf(Date);
      expect(created.status).toBe(ReviewStatus.COMPLETED);

      const log = (logService.create as jest.Mock).mock.calls[0][0];
      expect(log.severity).toBe(LogSeverity.INFO);
      expect(JSON.parse(log.message).response).toBe('skipped (DEV/LOC)');
    });

    it('fails closed (no persistence) when the wallet-user cannot be resolved', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue(undefined as any);
      httpService.post.mockResolvedValue({} as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      // an unresolved wallet-user has no FK to persist against — never forward, never touch the table
      expect(httpService.post).not.toHaveBeenCalled();
      expect(aktionariatManager.transaction).not.toHaveBeenCalled();
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
      expect(logService.create).toHaveBeenCalledWith(expect.objectContaining({ severity: LogSeverity.ERROR }));
    });

    it('records the failed forward as a MANUAL_REVIEW row (persist in both branches)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockRejectedValue({ response: { data: { message: 'aktionariat rejected' } } });

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      // the failed attempt is still persisted, as MANUAL_REVIEW with no forwarded date
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.status).toBe(ReviewStatus.MANUAL_REVIEW);
      expect(created.forwardedToAktionariatDate).toBeUndefined();
      // a MANUAL_REVIEW row is NOT gated on a confirmation mail (none was ever sent) — no confirm dead-end
      expect(created.requiresEmailConfirmation).toBe(false);
      expect(logService.create).toHaveBeenCalledWith(expect.objectContaining({ severity: LogSeverity.ERROR }));
    });

    it('opens a support ticket for the parked MANUAL_REVIEW registration (KYC_ISSUE/Other, wallet in the message)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      const sourceWallet = { id: 7, name: 'RealUnit' };
      // the wallet-user's wallet is the source-app attribution passed to the ticket
      userService.getUserByAddress.mockResolvedValue({ id: 42, wallet: sourceWallet } as any);
      httpService.post.mockRejectedValue({ response: { data: { message: 'aktionariat rejected' } } });

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      expect(supportIssueService.createIssueInternal).toHaveBeenCalledTimes(1);
      const [ticketUserData, ticketDto, ticketWallet] = (supportIssueService.createIssueInternal as jest.Mock).mock
        .calls[0];
      expect(ticketUserData).toMatchObject({ id: 1 });
      expect(ticketDto).toMatchObject({
        type: SupportIssueType.KYC_ISSUE,
        reason: SupportIssueReason.AKTIONARIAT_FORWARDING_FAILED,
      });
      expect(ticketDto.message).toContain(wallet);
      // the source-app attribution is the wallet-user's wallet
      expect(ticketWallet).toBe(sourceWallet);
    });

    it('keeps the parked MANUAL_REVIEW registration even when opening the support ticket throws (best-effort)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 42, wallet: { id: 7 } } as any);
      httpService.post.mockRejectedValue({ response: { data: { message: 'aktionariat rejected' } } });
      supportIssueService.createIssueInternal.mockRejectedValue(new Error('ticket boom'));

      // the ticket failure must not rethrow: forwardRegistration still resolves to false
      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      // the MANUAL_REVIEW row is still committed (the ticket is opened after the persist, best-effort)
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      expect(created.status).toBe(ReviewStatus.MANUAL_REVIEW);
    });

    it('rolls back and returns false (nothing half-written) when the registration persist fails', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);
      // the COMPLETED persist fails inside the transaction -> the whole transaction rolls back
      aktionariatTxManager.save.mockRejectedValue(new Error('db down'));

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      // single persist attempt: on a rollback we do NOT fall back to a second MANUAL_REVIEW write
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      expect(logService.create).toHaveBeenCalledWith(expect.objectContaining({ severity: LogSeverity.ERROR }));
    });

    it('self-heals on retry: after a persist failure the client retry re-POSTs (harmless upsert) and completes', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);
      // first attempt: the POST succeeds but the COMPLETED persist fails -> the transaction rolls back, no row
      aktionariatTxManager.save.mockRejectedValueOnce(new Error('db down'));

      const first = await (service as any).forwardRegistration(fakeUserData(10), dto);

      // nothing durable was written -> returns false, but the failed attempt leaves no blocking row
      expect(first).toBe(false);
      expect(httpService.post).toHaveBeenCalledTimes(1);

      // client retry: registerUser is an idempotent upsert, so re-POSTing is harmless; the persist now succeeds
      const second = await (service as any).forwardRegistration(fakeUserData(10), dto);

      expect(second).toBe(true);
      // the POST runs unconditionally (outside the persist txn), so its count alone does not prove the retry;
      // the self-heal is shown by the second attempt actually persisting a COMPLETED row — the rolled-back
      // first attempt left no active row to short-circuit it.
      expect(httpService.post).toHaveBeenCalledTimes(2);
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(2);
      const persisted = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls.at(-1)[0];
      expect(persisted.status).toBe(ReviewStatus.COMPLETED); // the retry persists the COMPLETED registration
    });

    it('re-checks idempotency inside a per-wallet-user advisory lock and does not persist again', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 55 } as any);
      httpService.post.mockResolvedValue({} as any);
      // a concurrent/earlier caller already registered this wallet (active COMPLETED, same signature)
      aktionariatTxManager.findOne.mockResolvedValue({
        id: 9,
        status: ReviewStatus.COMPLETED,
        signature,
      });

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      // advisory lock taken on the wallet-user inside the persist transaction
      expect(aktionariatTxManager.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), [
        'aktionariat_registration',
        55,
      ]);
      // the POST now runs OUTSIDE the txn and is harmless under Aktionariat's upsert; the in-lock recheck
      // only prevents a duplicate PERSIST when a concurrent caller has already completed the wallet
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
    });

    it('lifts the KYC level on the in-lock idempotent outcome (concurrent completion of the same wallet)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 55 } as any);
      httpService.post.mockResolvedValue({} as any);
      // a concurrent caller already completed this wallet (same signature) -> our persist short-circuits idempotent
      aktionariatTxManager.findOne.mockResolvedValue({ id: 9, status: ReviewStatus.COMPLETED, signature });

      const ok = await (service as any).forwardRegistration(fakeUserData(10), dto);

      expect(ok).toBe(true);
      expect(aktionariatTxManager.save).not.toHaveBeenCalled(); // no duplicate persist on the idempotent outcome
      // the idempotent outcome must still (best-effort) lift THIS caller's KYC level, else its buy/sell gate stays shut
      expect(userDataService.updateUserDataInternal).toHaveBeenCalledTimes(1);
      const [, update] = (userDataService.updateUserDataInternal as jest.Mock).mock.calls[0];
      expect(update.kycLevel).toBe(20);
    });

    it('rejects an in-lock COMPLETED short-circuit when the incoming signature differs', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 55 } as any);
      httpService.post.mockResolvedValue({} as any);
      // concurrent path: active COMPLETED for this wallet was written under a different signature
      aktionariatTxManager.findOne.mockResolvedValue({
        id: 9,
        status: ReviewStatus.COMPLETED,
        signature: '0xdifferentpriorregistration',
      });

      // POST may already have run (outside the txn); the lock path must still fail closed on signature
      await expect((service as any).forwardRegistration(fakeUserData(), dto)).rejects.toThrow(BadRequestException);
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
    });

    it('short-circuits only a COMPLETED prior registration, so an admin re-forward of a MANUAL_REVIEW row still forwards', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 55 } as any);
      aktionariatTxManager.findOne.mockResolvedValue(undefined);
      httpService.post.mockResolvedValue({} as any);

      await (service as any).forwardRegistration(fakeUserData(), dto);

      // the in-lock re-check must match ONLY a genuinely COMPLETED row (a plain enum, not Not(In([...]))),
      // otherwise a MANUAL_REVIEW row would be mistaken for "already registered" and the admin re-forward
      // (the sole remediation path for a failed forward) would become a silent no-op.
      const where = (aktionariatTxManager.findOne as jest.Mock).mock.calls[0][1].where;
      expect(where.active).toBe(true);
      expect(where.walletAddress).toBe(wallet.toLowerCase());
      expect(where.status).toBe(ReviewStatus.COMPLETED);
    });

    it('treats a unique-index violation on persist as an idempotent success (concurrent completion)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 7 } as any);
      httpService.post.mockResolvedValue({} as any);
      // a concurrent caller committed the active row first -> our insert violates the partial unique index
      aktionariatTxManager.save.mockRejectedValue({ code: '23505' });
      const ensureSpy = jest.spyOn(service as any, 'ensureRegistrationKycLevel');

      const ok = await (service as any).forwardRegistration(fakeUserData(10), dto);

      expect(ok).toBe(true);
      // the collision is NOT recorded as a failure
      expect(logService.create).not.toHaveBeenCalledWith(expect.objectContaining({ severity: LogSeverity.ERROR }));
      // the idempotent-collision path still (best-effort) lifts the KYC level
      expect(ensureSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });

    it('writes the full Aktionariat error body to the DB log but keeps the Loki line redacted', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      const leaked = 'leaked.person@example.com';
      const errorBody = { message: `E-Mail ${leaked} already registered` };
      httpService.post.mockRejectedValue({
        name: 'ConflictException',
        response: { status: 409, data: errorBody },
      });

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      // DB log is the DESIGNATED PII audit store: it now carries the FULL Aktionariat error body verbatim
      const errorLog = (logService.create as jest.Mock).mock.calls.find((c) => c[0].severity === LogSeverity.ERROR)[0];
      expect(JSON.parse(errorLog.message).error).toEqual(errorBody);
      expect(errorLog.message).toContain(leaked); // the full body IS present in the PII audit store (by design)
      // Loki (this.logger.error) stays redacted: status/type only, never the leaked email
      const lokiLine = ((service as any).logger.error as jest.Mock).mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('Failed to forward RealUnit registration to Aktionariat'));
      expect(lokiLine).toContain('status=409 type=ConflictException');
      expect(lokiLine).not.toContain(leaked);
    });

    it('lifts the wallet-user to KYC level 20 on first registration', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(10), dto);

      expect(ok).toBe(true);
      expect(userDataService.updateUserDataInternal).toHaveBeenCalledTimes(1);
      const [, update] = (userDataService.updateUserDataInternal as jest.Mock).mock.calls[0];
      expect(update.kycLevel).toBe(20);
    });

    it('keeps a successful registration even when the audit log write fails', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);
      logService.create.mockRejectedValue(new Error('log down'));

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
    });

    it('supersedes a prior active registration (deactivate + re-insert) without a unique violation', async () => {
      const wallet = softwareWallet.address; // EIP-55 mixed-case address from the client
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      userService.getUserByAddress.mockResolvedValue({ id: 7 } as any);
      httpService.post.mockResolvedValue({} as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      // prior active rows for this wallet-user are deactivated (kept as history) before the insert
      expect(aktionariatTxManager.update).toHaveBeenCalledWith(
        AktionariatRegistration,
        { user: { id: 7 }, active: true },
        { active: false },
      );
      const created = (aktionariatRegistrationRepo.create as jest.Mock).mock.calls[0][0];
      // queryable column is canonically lowercased, but the signed payload keeps the exact signed
      // (mixed-case) address — lowercasing the payload would break EIP-712 signature recovery.
      expect(created.walletAddress).toBe(wallet.toLowerCase());
      expect(created.active).toBe(true);
      const saved = (aktionariatTxManager.save as jest.Mock).mock.calls[0][0];
      expect(saved.signedPayloadData.walletAddress).toBe(wallet);
      // deactivate must run before the insert (atomic supersede — no unique-index clash)
      const updateOrder = (aktionariatTxManager.update as jest.Mock).mock.invocationCallOrder[0];
      const saveOrder = (aktionariatTxManager.save as jest.Mock).mock.invocationCallOrder[0];
      expect(updateOrder).toBeLessThan(saveOrder);
    });

    it('falls back to the raw (non-transliterated) message when the signature cannot be resolved', async () => {
      // resolveSignedRegistrationMessage returns undefined -> the `?? buildRegistrationMessage(dto, false)`
      // fallback builds the forwarded payload from the raw UTF-8 fields.
      const wallet = softwareWallet.address;
      const dto = buildDto(utf8Fields(wallet), '0xdeadbeef');
      jest.spyOn(service as any, 'resolveSignedRegistrationMessage').mockReturnValue(undefined);
      httpService.post.mockResolvedValue({} as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      const payload = forwardedPayload();
      expect(payload.name).toBe('Erika Müller'); // raw UTF-8, not transliterated
      expect(payload.addressCity).toBe('Zürich');
    });

    it('rolls back in DEV/LOC (no forward) when the persist fails and surfaces the DB error non-PII', async () => {
      mockEnvironment = 'loc';
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      aktionariatTxManager.save.mockRejectedValue(new Error('db down'));

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      expect(httpService.post).not.toHaveBeenCalled();
      // single persist attempt: the transaction rolls back, no MANUAL_REVIEW fallback write
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      const errorLog = (logService.create as jest.Mock).mock.calls.find((c) => c[0].severity === LogSeverity.ERROR)[0];
      // the persist-failure path carries no registerResponse; the DB log records the full Error body (name+message)
      expect(JSON.parse(errorLog.message).response).toBeUndefined();
      expect(JSON.parse(errorLog.message).error).toEqual({ name: 'Error', message: 'db down' });
    });

    it('surfaces the forward root cause in the audit log (and the raw-string persist error to the app log) when both fail', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockRejectedValue(new Error('aktionariat down')); // forward fails -> MANUAL_REVIEW persist attempt
      aktionariatTxManager.save.mockRejectedValue('manual-review string failure'); // that persist also fails (raw string, no .message)

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(false);
      // the transaction rolled back after a single (failed) persist attempt
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      // the raw-string persist error is surfaced to the app log (no .message to read)
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('manual-review string failure'),
      );
      const errorLog = (logService.create as jest.Mock).mock.calls.find((c) => c[0].severity === LogSeverity.ERROR)[0];
      // the audit log keeps the forward root cause (forwardError ?? error prefers the original forward error)
      expect(JSON.parse(errorLog.message).error).toEqual({ name: 'Error', message: 'aktionariat down' });
    });

    it('keeps a successful registration when the audit log write rejects without a message', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);
      logService.create.mockRejectedValue('log string failure'); // no .message -> hits the `|| e` side

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
    });

    it('forwards to Aktionariat BEFORE opening the persist transaction (the POST is not held inside the txn)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(), dto);

      expect(ok).toBe(true);
      // N2: the external POST must run outside/before the persist transaction, so no pooled connection is
      // pinned across the (up to 30s) call.
      const postOrder = (httpService.post as jest.Mock).mock.invocationCallOrder[0];
      const txnOrder = (aktionariatManager.transaction as jest.Mock).mock.invocationCallOrder[0];
      expect(postOrder).toBeLessThan(txnOrder);
    });

    it('skips the KYC level-20 lift when the wallet-user is already at level 20 or above', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);

      const ok = await (service as any).forwardRegistration(fakeUserData(KycLevel.LEVEL_20), dto);

      expect(ok).toBe(true);
      expect(userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    });

    it('keeps the durable registration when the best-effort KYC lift rejects (self-heals on retry)', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);
      userDataService.updateUserDataInternal.mockRejectedValue(new Error('kyc write down'));

      const ok = await (service as any).forwardRegistration(fakeUserData(10), dto);

      // the COMPLETED persist already committed, so a failed lift must not fail the registration
      expect(ok).toBe(true);
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(1);
      expect((service as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('will self-heal on retry'));
    });

    it('keeps the registration when the KYC lift rejects without a message', async () => {
      const wallet = softwareWallet.address;
      const signature = await softwareWallet._signTypedData(domain, types, utf8Fields(wallet));
      const dto = buildDto(utf8Fields(wallet), signature);
      httpService.post.mockResolvedValue({} as any);
      userDataService.updateUserDataInternal.mockRejectedValue('kyc string failure'); // no .message -> hits the `|| e` side

      const ok = await (service as any).forwardRegistration(fakeUserData(10), dto);

      expect(ok).toBe(true);
      expect((service as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('kyc string failure'));
    });
  });

  describe('idempotentRegistrationResult (self-heals the KYC lift on the COMPLETED retry)', () => {
    it('re-asserts the best-effort KYC lift for a COMPLETED registration', async () => {
      const ensureSpy = jest.spyOn(service as any, 'ensureRegistrationKycLevel').mockResolvedValue(undefined);
      const userData = { id: 1, kycLevel: KycLevel.LEVEL_10 } as any;
      const registration = { id: 2, signature: '0xsig', status: ReviewStatus.COMPLETED } as any;

      const status = await (service as any).idempotentRegistrationResult(userData, registration, '0xsig');

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
      expect(ensureSpy).toHaveBeenCalledWith(userData);
    });

    it('does NOT re-assert the KYC lift for a non-COMPLETED (MANUAL_REVIEW) registration', async () => {
      const ensureSpy = jest.spyOn(service as any, 'ensureRegistrationKycLevel').mockResolvedValue(undefined);
      const userData = { id: 1, kycLevel: KycLevel.LEVEL_10 } as any;
      const registration = { id: 2, signature: '0xsig', status: ReviewStatus.MANUAL_REVIEW } as any;

      const status = await (service as any).idempotentRegistrationResult(userData, registration, '0xsig');

      expect(status).toBe(RealUnitRegistrationStatus.FORWARDING_FAILED);
      expect(ensureSpy).not.toHaveBeenCalled();
    });
  });

  describe('describeError (full error body for the PII audit DB log)', () => {
    it('returns the Aktionariat HTTP error body verbatim when present (the useful, complete part)', () => {
      const body = { message: 'E-Mail erika.mueller@example.com already registered' };
      const error = { name: 'ConflictException', response: { status: 409, data: body } };
      expect((service as any).describeError(error)).toEqual(body);
    });

    it('prefers the HTTP error body over the Error identity for a real Error carrying a response (Axios shape)', () => {
      const body = { message: 'E-Mail erika.mueller@example.com already registered' };
      const error = Object.assign(new Error('Request failed with status code 409'), {
        response: { status: 409, data: body },
      });
      expect((service as any).describeError(error)).toEqual(body);
    });

    it('returns a string error as-is', () => {
      expect((service as any).describeError('No user found for RealUnit wallet 0xabc')).toBe(
        'No user found for RealUnit wallet 0xabc',
      );
    });

    it("returns an Error's name and message", () => {
      expect((service as any).describeError(new TypeError('boom'))).toEqual({ name: 'TypeError', message: 'boom' });
    });

    it('falls back to the Error identity when the HTTP error body is null or empty', () => {
      const nullBody = Object.assign(new Error('boom'), {
        name: 'InternalServerError',
        response: { status: 500, data: null },
      });
      expect((service as any).describeError(nullBody)).toEqual({ name: 'InternalServerError', message: 'boom' });
      const emptyBody = Object.assign(new Error('boom'), {
        name: 'BadGateway',
        response: { status: 502, data: '' },
      });
      expect((service as any).describeError(emptyBody)).toEqual({ name: 'BadGateway', message: 'boom' });
    });

    it('returns a raw non-Error, non-body value unchanged', () => {
      expect((service as any).describeError({ code: 'ETIMEDOUT' })).toEqual({ code: 'ETIMEDOUT' });
    });

    it('returns undefined for a null or undefined error', () => {
      expect((service as any).describeError(null)).toBeUndefined();
      expect((service as any).describeError(undefined)).toBeUndefined();
    });
  });

  describe('summarizeError (redacted error summary for the Loki app-log)', () => {
    it('keeps only status and error type for an HTTP error (never the PII-carrying body or message)', () => {
      // Axios-shaped: a real HTTP error always carries a message too — the response arm must win over
      // it, otherwise the PII-carrying message would leak into the redacted Loki summary.
      const error = Object.assign(new Error('Conflict: leaked@example.com'), {
        name: 'ConflictException',
        response: { status: 409, data: { message: 'leaked@example.com' } },
      });
      expect((service as any).summarizeError(error)).toBe('status=409 type=ConflictException');
    });

    it('falls back to the constructor name when a plain-object HTTP error carries no name', () => {
      expect((service as any).summarizeError({ response: { status: 500 } })).toBe('status=500 type=Object');
    });

    it("falls back to 'HttpError' when the HTTP error has neither a name nor a reachable constructor", () => {
      const error = Object.assign(Object.create(null), { response: { status: 502 } });
      expect((service as any).summarizeError(error)).toBe('status=502 type=HttpError');
    });

    it("reports the status as 'unknown' when the HTTP error carries no status", () => {
      const error = Object.assign(Object.create(null), { response: {} });
      expect((service as any).summarizeError(error)).toBe('status=unknown type=HttpError');
    });

    it('returns a string error as-is', () => {
      expect((service as any).summarizeError('No user found for RealUnit wallet 0xabc')).toBe(
        'No user found for RealUnit wallet 0xabc',
      );
    });

    it('uses the plain message for a non-HTTP error (network/DB, no submitted PII)', () => {
      expect((service as any).summarizeError(new Error('db down'))).toBe('db down');
    });

    it('stringifies a non-HTTP error that has no message', () => {
      expect((service as any).summarizeError(42)).toBe('42');
      expect((service as any).summarizeError({})).toBe('[object Object]');
    });

    it('returns undefined for a null or undefined error', () => {
      expect((service as any).summarizeError(null)).toBeUndefined();
      expect((service as any).summarizeError(undefined)).toBeUndefined();
    });
  });

  describe('forwardRegistrationToAktionariat (admin re-forward by registration id)', () => {
    it('throws NotFoundException when the registration id does not exist', async () => {
      aktionariatRegistrationRepo.findOne.mockResolvedValue(undefined);

      await expect(service.forwardRegistrationToAktionariat(123)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the registration is not in MANUAL_REVIEW', async () => {
      aktionariatRegistrationRepo.findOne.mockResolvedValue({ id: 1, status: ReviewStatus.COMPLETED } as any);

      await expect(service.forwardRegistrationToAktionariat(1)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the stored signed payload is missing', async () => {
      aktionariatRegistrationRepo.findOne.mockResolvedValue({
        id: 1,
        status: ReviewStatus.MANUAL_REVIEW,
        signedPayloadData: undefined,
        user: { userData: { id: 9 } },
      } as any);

      await expect(service.forwardRegistrationToAktionariat(1)).rejects.toThrow(BadRequestException);
    });

    it('re-forwards a MANUAL_REVIEW registration and resolves on success', async () => {
      const forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);
      aktionariatRegistrationRepo.findOne.mockResolvedValue({
        id: 5,
        status: ReviewStatus.MANUAL_REVIEW,
        signedPayloadData: { walletAddress: '0xabc', signature: '0xsig', email: 'e@example.com' },
        kycDataObj: { accountType: 'Personal' },
        user: { userData: { id: 9, kycLevel: 20 } },
      } as any);

      await expect(service.forwardRegistrationToAktionariat(5)).resolves.toBeUndefined();
      expect(forwardSpy).toHaveBeenCalledWith(
        { id: 9, kycLevel: 20 },
        expect.objectContaining({ walletAddress: '0xabc', kycData: { accountType: 'Personal' } }),
      );
    });

    it('throws BadRequestException when the re-forward fails', async () => {
      jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(false);
      aktionariatRegistrationRepo.findOne.mockResolvedValue({
        id: 5,
        status: ReviewStatus.MANUAL_REVIEW,
        signedPayloadData: { walletAddress: '0xabc', signature: '0xsig' },
        kycDataObj: undefined,
        user: { userData: { id: 9 } },
      } as any);

      await expect(service.forwardRegistrationToAktionariat(5)).rejects.toThrow(BadRequestException);
    });
  });

  describe('completeRegistration (orchestration)', () => {
    const dto: any = { walletAddress: '0xabc', signature: '0xsig', email: 'max@example.com', kycData: {} };

    beforeEach(() => {
      // the EIP-712 signature checks are exercised in their own describe; here we drive the orchestration
      jest.spyOn(service as any, 'validateRegistrationDto').mockResolvedValue(undefined);
    });

    it('throws NotFoundException when the wallet has no user', async () => {
      userService.getUserByAddress.mockResolvedValue(undefined as any);

      await expect(service.completeRegistration(1, dto)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the wallet belongs to a different account', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 2, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com' },
      } as any);

      await expect(service.completeRegistration(1, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when email registration is incomplete', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: 0, mail: null },
      } as any);

      await expect(service.completeRegistration(1, dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the submitted email does not match the registered one', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'other@example.com' },
      } as any);

      await expect(service.completeRegistration(1, dto)).rejects.toThrow(BadRequestException);
    });

    it('returns the idempotent result for an existing current-wallet registration', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', tin: null },
      } as any);
      // After the F2 fix the isForCurrentWallet branch reconstructs the registration via
      // toRegistrationDto (reads signedPayloadData) before syncing user_data.tin from the record.
      jest.spyOn(service as any, 'findRegistration').mockResolvedValue({
        registration: {
          id: 3,
          signature: '0xsig',
          status: ReviewStatus.COMPLETED,
          signedPayloadData: {
            email: 'max@example.com',
            name: 'Max',
            walletAddress: '0xabc',
            signature: '0xsig',
            registrationDate: '2026-01-01',
            swissTaxResidence: true,
            addressCountry: 'CH',
          },
          kycDataObj: { accountType: 'Personal' },
        },
        isForCurrentWallet: true,
      });

      const status = await service.completeRegistration(1, dto);

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
    });

    it('throws BadRequestException when existing personal data does not match', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', firstname: 'Max' },
      } as any);
      jest
        .spyOn(service as any, 'findRegistration')
        .mockResolvedValue({ registration: undefined, isForCurrentWallet: false });
      jest.spyOn(service as any, 'isPersonalDataMatching').mockReturnValue(false);

      await expect(service.completeRegistration(1, dto)).rejects.toThrow(BadRequestException);
    });

    it('forwards without re-saving matching personal data and returns COMPLETED', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', firstname: 'Max' },
      } as any);
      jest
        .spyOn(service as any, 'findRegistration')
        .mockResolvedValue({ registration: undefined, isForCurrentWallet: false });
      jest.spyOn(service as any, 'isPersonalDataMatching').mockReturnValue(true);
      const forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);

      const status = await service.completeRegistration(1, dto);

      expect(status).toBe(RealUnitRegistrationStatus.COMPLETED);
      expect(forwardSpy).toHaveBeenCalled();
      // Personal KYC fields stay untouched when they already match. dto has no countryAndTINs and
      // userData.tin is empty → tin persist is a no-op (no destructive null write).
      expect(userDataService.updatePersonalData).not.toHaveBeenCalled();
      expect(userDataService.updateUserDataInternal).not.toHaveBeenCalled();
    });

    it('persists personal data for a first-time customer (no existing firstname) before forwarding', async () => {
      const richDto: any = {
        walletAddress: '0xabc',
        signature: '0xsig',
        email: 'max@example.com',
        kycData: { accountType: 'Personal' },
        nationality: 'CH',
        birthday: '1990-01-01',
        lang: 'DE',
      };
      const userData: any = { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', firstname: null };
      userService.getUserByAddress.mockResolvedValue({ userData } as any);
      jest
        .spyOn(service as any, 'findRegistration')
        .mockResolvedValue({ registration: undefined, isForCurrentWallet: false });
      (service as any).countryService.getCountryWithSymbol.mockResolvedValue({ id: 1, symbol: 'CH' });
      (service as any).languageService.getLanguageBySymbol.mockResolvedValue({ id: 1, symbol: 'DE' });
      const forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);

      const status = await service.completeRegistration(1, richDto);

      expect(status).toBe(RealUnitRegistrationStatus.COMPLETED);
      // first-time customer -> KYC personal data is written before the forward
      expect(userDataService.updatePersonalData).toHaveBeenCalledWith(userData, richDto.kycData);
      const [, update] = (userDataService.updateUserDataInternal as jest.Mock).mock.calls[0];
      expect(update.nationality).toEqual({ id: 1, symbol: 'CH' });
      expect(update.birthday).toEqual(new Date('1990-01-01'));
      expect(update.language).toEqual({ id: 1, symbol: 'DE' });
      expect(forwardSpy).toHaveBeenCalled();
    });

    it('returns FORWARDING_FAILED when the forward fails', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', firstname: 'Max' },
      } as any);
      jest
        .spyOn(service as any, 'findRegistration')
        .mockResolvedValue({ registration: undefined, isForCurrentWallet: false });
      jest.spyOn(service as any, 'isPersonalDataMatching').mockReturnValue(true);
      jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(false);

      const status = await service.completeRegistration(1, dto);

      expect(status).toBe(RealUnitRegistrationStatus.FORWARDING_FAILED);
    });

    it('F1: does not call forwardRegistration when countryAndTINs is too large', async () => {
      // Exercise the real tax-residence guard (serialized-length fail-closed) without the full EIP-712 path.
      jest.spyOn(service as any, 'validateRegistrationDto').mockImplementation(async (d: any) => {
        (service as any).validateTaxResidenceCoversAddress(d);
      });
      jest.spyOn(service as any, 'serializeCountryAndTins').mockReturnValue('x'.repeat(1025));
      const forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);

      const oversizedDto: any = {
        walletAddress: '0xabc',
        signature: '0xsig',
        email: 'max@example.com',
        addressCountry: 'DE',
        swissTaxResidence: false,
        countryAndTINs: [{ country: 'DE', tin: 'DE123456789' }],
        kycData: {},
      };
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', firstname: 'Max' },
      } as any);

      await expect(service.completeRegistration(1, oversizedDto)).rejects.toThrow(/countryAndTINs is too large/);
      expect(forwardSpy).not.toHaveBeenCalled();
    });

    it('F2: does not write user_data.tin when the idempotent path rejects a signature mismatch', async () => {
      userService.getUserByAddress.mockResolvedValue({
        userData: { id: 1, kycLevel: KycLevel.LEVEL_10, mail: 'max@example.com', tin: null },
      } as any);
      jest.spyOn(service as any, 'findRegistration').mockResolvedValue({
        registration: {
          id: 3,
          signature: '0xSTORED_SIGNATURE',
          status: ReviewStatus.COMPLETED,
          signedPayloadData: {
            email: 'max@example.com',
            name: 'Max',
            walletAddress: '0xabc',
            signature: '0xSTORED_SIGNATURE',
            registrationDate: '2026-01-01',
            swissTaxResidence: true,
            addressCountry: 'CH',
            countryAndTINs: [{ country: 'DE', tin: 'DE-STORED' }],
          },
          kycDataObj: { accountType: 'Personal' },
        },
        isForCurrentWallet: true,
      });
      // Incoming signature does NOT match the stored one; body carries a different TIN set.
      const mismatchDto: any = {
        ...dto,
        signature: '0xMISMATCHING_SIGNATURE',
        countryAndTINs: [{ country: 'FR', tin: 'FR-ATTACKER' }],
      };

      await expect(service.completeRegistration(1, mismatchDto)).rejects.toThrow(BadRequestException);

      const tinWrites = (userDataService.updateUserDataInternal as jest.Mock).mock.calls
        .map((c) => c[1])
        .filter((u) => u && Object.prototype.hasOwnProperty.call(u, 'tin'));
      expect(tinWrites).toHaveLength(0);
      expect(logService.create).not.toHaveBeenCalledWith(expect.objectContaining({ subsystem: 'UserDataTin' }));
    });

    it('F2: syncs user_data.tin from the stored registration, not the request body, on idempotent retry', async () => {
      const storedTins = [{ country: 'DE', tin: 'DE-STORED' }];
      const bodyTins = [{ country: 'FR', tin: 'FR-FROM-BODY' }];
      const userData: any = {
        id: 1,
        kycLevel: KycLevel.LEVEL_10,
        mail: 'max@example.com',
        tin: null,
      };
      userService.getUserByAddress.mockResolvedValue({ userData } as any);
      jest.spyOn(service as any, 'findRegistration').mockResolvedValue({
        registration: {
          id: 3,
          signature: '0xsig',
          status: ReviewStatus.COMPLETED,
          signedPayloadData: {
            email: 'max@example.com',
            name: 'Max',
            walletAddress: '0xabc',
            signature: '0xsig',
            registrationDate: '2026-01-01',
            swissTaxResidence: true,
            addressCountry: 'CH',
            countryAndTINs: storedTins,
          },
          kycDataObj: { accountType: 'Personal' },
        },
        isForCurrentWallet: true,
      });
      logService.create.mockResolvedValue({} as any);

      const status = await service.completeRegistration(1, { ...dto, countryAndTINs: bodyTins });

      expect(status).toBe(RealUnitRegistrationStatus.ALREADY_REGISTERED);
      const tinWrites = (userDataService.updateUserDataInternal as jest.Mock).mock.calls
        .map((c) => c[1])
        .filter((u) => u && Object.prototype.hasOwnProperty.call(u, 'tin'));
      expect(tinWrites).toEqual([{ tin: JSON.stringify(storedTins) }]);
      expect(tinWrites[0].tin).not.toContain('FR-FROM-BODY');
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
    // The controller forwards the untouched incoming request (full URL + every query param) so the audit can
    // record params the DTO strips. A generic value for the calls that don't assert on it; the raw-request
    // logging tests below build their own with extra params.
    const rawRequest = {
      url: `/v1/realunit/confirm-aktionariat?email=${email}&code=${code}&user=${user}`,
      query: { email, code, user } as Record<string, unknown>,
    };
    // Registration walletAddress columns are canonically lowercase; the confirm flow returns the signed
    // (mixed-case) address but latches the confirmed state onto the lowercased registration row.
    const walletA = '0xaaa0000000000000000000000000000000000001';
    const walletB = '0xbbb0000000000000000000000000000000000002';

    // getRegisteredWalletAddresses reads the registration table by email and returns the exact signed
    // (mixed-case) address from signedPayloadData; each row also carries the lowercase column as fallback.
    const mockRegisteredWallets = (walletAddresses: string[]) =>
      aktionariatRegistrationRepo.find.mockResolvedValue(
        walletAddresses.map((walletAddress) => ({
          walletAddress: walletAddress.toLowerCase(),
          signedPayloadData: { walletAddress },
        })) as any,
      );

    // applyRegistrationConfirmation loads the ACTIVE registration inside the advisory-locked transaction and
    // latches confirmedDate onto it. Return a FRESH row per lookup (a shared object would carry the latch set
    // for a prior wallet into the next). Pass a confirmedDate to simulate an already-confirmed (first-wins) row.
    const mockActiveRegistration = (confirmedDate: Date | null = null) =>
      aktionariatTxManager.findOne.mockImplementation(async () => ({ active: true, confirmedDate }));

    afterEach(() => {
      mockEnvironment = 'loc';
      mockAktionariatUrl = 'https://mock-aktionariat.example.com';
    });

    it('returns confirmed via the deterministic DEV/LOC mock and latches confirmedDate onto the registration', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      expect(result.confirmedAddresses).toEqual([walletA]);
      expect(result.confirmedDate).toBeInstanceOf(Date);
      expect(httpService.getRaw).not.toHaveBeenCalled();
      const audit = (logService.create as jest.Mock).mock.calls.find((c) => c[0].category === 'ServerCall')[0];
      expect(audit.severity).toBe(LogSeverity.INFO);
      // the latch is set on the active registration row and saved through the transactional manager
      expect(aktionariatTxManager.save).toHaveBeenCalledWith(
        expect.objectContaining({ active: true, confirmedDate: expect.any(Date) }),
      );
    });

    it('de-duplicates repeated wallets (historical + active rows) and latches each distinct wallet once', async () => {
      mockRegisteredWallets([walletA, walletA, walletB]);
      mockActiveRegistration();

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.confirmedAddresses).toEqual([walletA, walletB]);
      // one advisory-locked latch transaction per distinct wallet
      expect(aktionariatManager.transaction).toHaveBeenCalledTimes(2);
      expect(aktionariatTxManager.save).toHaveBeenCalledTimes(2);
    });

    it('de-duplicates the same wallet case-insensitively and keeps the first-seen (signed) casing', async () => {
      // historical mixed casing / signed payload vs lowercased column must not yield two latch transactions
      const checksummed = '0xAaA0000000000000000000000000000000000001';
      const lower = checksummed.toLowerCase();
      aktionariatRegistrationRepo.find.mockResolvedValue([
        { walletAddress: lower, signedPayloadData: { walletAddress: checksummed } },
        { walletAddress: lower, signedPayloadData: { walletAddress: lower } },
        { walletAddress: lower, signedPayloadData: undefined }, // fallback to lowercased column
      ] as any);
      mockActiveRegistration();

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.confirmedAddresses).toEqual([checksummed]);
      expect(aktionariatManager.transaction).toHaveBeenCalledTimes(1);
    });

    it('looks wallets up by a case-insensitive LOWER(email) predicate (Raw SQL generator)', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();

      await service.confirmAktionariat({ email: 'MiXeD@example.com', code, user }, rawRequest);

      // the email filter is a TypeORM Raw operator; execute its SQL generator to prove the predicate
      const op = (aktionariatRegistrationRepo.find as jest.Mock).mock.calls[0][0].where.email;
      expect(op.getSql('reg.email')).toBe('LOWER(reg.email) = :email');
    });

    it('returns the exact signed (mixed-case) address, not the lowercase column', async () => {
      const checksummed = '0xAbC0000000000000000000000000000000000009';
      aktionariatRegistrationRepo.find.mockResolvedValue([
        { walletAddress: checksummed.toLowerCase(), signedPayloadData: { walletAddress: checksummed } },
        { walletAddress: '0xdef0000000000000000000000000000000000010', signedPayloadData: undefined }, // fallback path
      ] as any);
      mockActiveRegistration();

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.confirmedAddresses).toEqual([checksummed, '0xdef0000000000000000000000000000000000010']);
    });

    // THE KEY CASE: a 0-match confirm (email resolves to zero wallets) used to lose its audit entirely (the
    // persist + log both lived inside the per-wallet loop). The audit now fires ONCE per call, before and
    // outside the loop, so the full call is recorded durably even with no wallet resolved.
    it('durably audits a 0-match call (zero wallets): exactly ONE DB-log row, no registration touched, no throw', async () => {
      mockRegisteredWallets([]);

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      // the call still resolves, but reports that no local registration could be confirmed
      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED_NO_REGISTRATION);
      expect(result.confirmedAddresses).toEqual([]);
      expect(result.confirmedDate).toBeUndefined();
      // NO registration was touched — no latch transaction ran
      expect(aktionariatManager.transaction).not.toHaveBeenCalled();
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
      // but the full call is recorded EXACTLY ONCE in the DB `log` audit store, with an empty wallet list
      const audits = (logService.create as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((e) => e.category === 'ServerCall');
      expect(audits).toHaveLength(1);
      const msg = JSON.parse(audits[0].message);
      expect(msg.walletAddresses).toEqual([]);
      expect(msg.email).toBe(email);
      expect(msg.user).toBe(user);
      const audit = (logService.create as jest.Mock).mock.calls.find((c) => c[0].category === 'ServerCall')[0];
      expect(audit.severity).toBe(LogSeverity.ERROR);
      expect((service as any).logger.error).toHaveBeenCalled();
    });

    it('masks an email without an @ sign without crashing', async () => {
      mockRegisteredWallets([]);

      const result = await service.confirmAktionariat({ email: 'no-at-sign', code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED_NO_REGISTRATION);
    });

    it('calls the real Aktionariat endpoint and maps a 2xx to confirmed', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();
      httpService.getRaw.mockResolvedValue({ status: 200, data: { status: 200, message: 'ok' } } as any);

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      const calledUrl = httpService.getRaw.mock.calls[0][0] as string;
      expect(calledUrl).toContain('https://mock-aktionariat.example.com/confirmconnection');
      expect(calledUrl).toContain(`code=${encodeURIComponent(code)}`);
      // An explicit request timeout must be passed so a hung connection resolves to unavailable.
      expect(httpService.getRaw).toHaveBeenCalledWith(expect.any(String), { timeout: 10000 });
    });

    it('maps a 4xx (403 Code not found) to invalid, latches nothing, and returns no confirmedDate', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      httpService.getRaw.mockRejectedValue({
        response: { status: 403, data: { status: 403, message: 'Code not found' } },
      });

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.INVALID);
      expect(result.confirmedAddresses).toEqual([]);
      expect(result.confirmedDate).toBeUndefined();
      // a non-confirming call never touches a registration (the latch is only set on a 2xx)
      expect(aktionariatManager.transaction).not.toHaveBeenCalled();
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
      // a 4xx is a handled rejection (mapped to INVALID above), not a fault — logged at warn
      expect((service as any).logger.warn).toHaveBeenCalled();
      expect((service as any).logger.error).not.toHaveBeenCalled();
    });

    it('keeps a 429 (throttling) at error — a systemic fault, not a rejected link', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      httpService.getRaw.mockRejectedValue({
        response: { status: 429, data: { status: 429, message: 'Too many requests' } },
      });

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      // the client-facing mapping still buckets it as INVALID (4xx), only the log level differs
      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.INVALID);
      expect((service as any).logger.error).toHaveBeenCalled();
      const warnText = (service as any).logger.warn.mock.calls.flat().join(' ');
      expect(warnText).not.toContain('Aktionariat confirmation call');
    });

    it('keeps the FIRST confirmedDate on a re-confirm and returns the stored (not transient) date', async () => {
      // The wallet's active registration already carries a confirmation date from an earlier confirm.
      const firstDate = new Date('2026-05-01T00:00:00.000Z');
      mockRegisteredWallets([walletA]);
      mockActiveRegistration(firstDate);

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      // the latch is never advanced: with confirmedDate already set, no save is issued
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
      // the 2xx response surfaces the PERSISTED first date, never a transient new Date()
      expect(result.confirmedDate).toBe(firstDate);
    });

    it('is a safe no-op (still audited, no throw) when no active registration matches a resolved wallet', async () => {
      mockRegisteredWallets([walletA]);
      aktionariatTxManager.findOne.mockResolvedValue(undefined); // no active registration row

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      expect(result.confirmedAddresses).toEqual([walletA]);
      expect(result.confirmedDate).toBeUndefined();
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
      // the call is still fully audited (exactly once)
      const audits = (logService.create as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((e) => e.category === 'ServerCall');
      expect(audits).toHaveLength(1);
      expect((service as any).logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No active RealUnit registration to confirm'),
      );
    });

    it('maps a 5xx to unavailable (string error body) and latches nothing', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      httpService.getRaw.mockRejectedValue({ response: { status: 503, data: 'Service Unavailable' } });

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.UNAVAILABLE);
      expect(result.confirmedAddresses).toEqual([]);
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
    });

    it('maps a network/timeout error (Error with message) to unavailable', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      httpService.getRaw.mockRejectedValue(new Error('timeout of 30000ms exceeded'));

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.UNAVAILABLE);
      expect(aktionariatTxManager.save).not.toHaveBeenCalled();
    });

    it('maps an error with neither response nor message to unavailable', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      httpService.getRaw.mockRejectedValue({});

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.UNAVAILABLE);
      expect((service as any).logger.error).toHaveBeenCalled();
    });

    it('throws when AKTIONARIAT_URL is not configured outside DEV/LOC', async () => {
      mockEnvironment = 'prd';
      mockAktionariatUrl = undefined;
      mockRegisteredWallets([]);

      await expect(service.confirmAktionariat({ email, code, user }, rawRequest)).rejects.toThrow(
        'Aktionariat URL is not configured',
      );
      expect(httpService.getRaw).not.toHaveBeenCalled();
      expect((service as any).logger.error).toHaveBeenCalledWith('Aktionariat URL is not configured');
    });

    it('preserves the 2xx response body shape ({ status, confirmedAddresses, confirmedDate }) the web depends on', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(Object.keys(result).sort()).toEqual(['confirmedAddresses', 'confirmedDate', 'status']);
      expect(Object.values(RealUnitAktionariatConfirmationStatus)).toContain(result.status);
    });

    it('writes exactly ONE full ServerCall DB audit row per call (not per wallet), with the resolved wallet list', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA, walletB]);
      mockActiveRegistration();
      httpService.getRaw.mockResolvedValue({ status: 200, data: { aktionariatConfirmed: true } } as any);

      await service.confirmAktionariat({ email, code, user }, rawRequest);

      const audits = (logService.create as jest.Mock).mock.calls
        .map((c) => c[0])
        .filter((e) => e.category === 'ServerCall');
      // ONE row for the whole call, even though two wallets were resolved
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        system: 'Aktionariat',
        subsystem: 'Confirmation',
        category: 'ServerCall',
        severity: LogSeverity.INFO,
      });
      const msg = JSON.parse(audits[0].message);
      expect(msg.action).toBe('confirmConnection');
      expect(msg.email).toBe(email);
      expect(msg.code).toBe(code);
      expect(msg.user).toBe(user);
      expect(msg.walletAddresses).toEqual([walletA, walletB]);
      expect(msg.response).toEqual({ aktionariatConfirmed: true });
      expect(msg.error).toBeUndefined();
      // a uniqueness marker rides in every audit message so LogService.create() never dedups two identical rows
      expect(msg.loggedAt).toEqual(expect.any(String));
      expect(msg.logNonce).toEqual(expect.any(String));
    });

    it('writes a UNIQUE ServerCall message for two byte-identical re-confirms so LogService dedup cannot collapse them', async () => {
      // Two identical re-confirms: without a per-write uniqueness marker LogService.create (which drops a row
      // whose message equals the latest existing one) would silently collapse the second audit row.
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();

      await service.confirmAktionariat({ email, code, user }, rawRequest);
      await service.confirmAktionariat({ email, code, user }, rawRequest);

      const serverCallMessages = (logService.create as jest.Mock).mock.calls
        .map((call) => call[0])
        .filter((entry) => entry.category === 'ServerCall')
        .map((entry) => entry.message);
      expect(serverCallMessages).toHaveLength(2);
      const [first, second] = serverCallMessages;
      // the loggedAt/logNonce marker makes the two byte-identical audit payloads differ
      expect(first).not.toBe(second);
      expect(JSON.parse(first).logNonce).toEqual(expect.any(String));
      expect(JSON.parse(second).logNonce).toEqual(expect.any(String));
    });

    it('records the full Aktionariat error body in the DB audit but keeps the Loki line redacted', async () => {
      mockEnvironment = 'prd';
      const leakedEmail = 'leaked-user@example.com';
      mockRegisteredWallets([walletA]);
      const errorBody = { status: 403, message: `E-Mail ${leakedEmail} not confirmed` };
      httpService.getRaw.mockRejectedValue({ response: { status: 403, data: errorBody } });

      await service.confirmAktionariat({ email, code, user }, rawRequest);

      // DB log is the PII audit store: it carries the FULL error body and is tagged INVALID->WARNING
      const audit = (logService.create as jest.Mock).mock.calls.find((c) => c[0].category === 'ServerCall')[0];
      expect(audit.severity).toBe(LogSeverity.WARNING);
      const msg = JSON.parse(audit.message);
      expect(msg.error).toEqual(errorBody);
      expect(msg.response).toBeUndefined();
      expect(audit.message).toContain(leakedEmail);

      // Loki stays PII-free: the leaked email must never reach this.logger.warn (a 4xx logs at warn, not error)
      const lokiText = (service as any).logger.warn.mock.calls.flat().join(' ');
      expect(lokiText).toContain('status=403');
      expect(lokiText).not.toContain(leakedEmail);
    });

    it('tags an unavailable (5xx) confirmation audit row as ERROR', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      httpService.getRaw.mockRejectedValue({ response: { status: 503, data: 'Service Unavailable' } });

      await service.confirmAktionariat({ email, code, user }, rawRequest);

      const audit = (logService.create as jest.Mock).mock.calls.find((c) => c[0].category === 'ServerCall')[0];
      expect(audit.severity).toBe(LogSeverity.ERROR);
    });

    it('serialises the registration latch with a per-wallet advisory lock on aktionariat_registration', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();

      await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(aktionariatManager.transaction).toHaveBeenCalledTimes(1);
      expect(aktionariatTxManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        ['aktionariat_registration', walletA],
      );
    });

    it('latches on the lowercased wallet while the response keeps the signed (mixed-case) address', async () => {
      const checksummed = '0xAbC0000000000000000000000000000000000009';
      aktionariatRegistrationRepo.find.mockResolvedValue([
        { walletAddress: checksummed.toLowerCase(), signedPayloadData: { walletAddress: checksummed } },
      ] as any);
      mockActiveRegistration();

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      // response shape unchanged: still the signed mixed-case address
      expect(result.confirmedAddresses).toEqual([checksummed]);
      // the advisory lock + active-registration lookup use the lowercased address
      expect(aktionariatTxManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))',
        ['aktionariat_registration', checksummed.toLowerCase()],
      );
      const where = (aktionariatTxManager.findOne as jest.Mock).mock.calls[0][1].where;
      expect(where).toEqual({ walletAddress: checksummed.toLowerCase(), active: true });
    });

    it('propagates a persistence error from the registration latch transaction', async () => {
      mockRegisteredWallets([walletA]);
      aktionariatTxManager.findOne.mockResolvedValue({ active: true, confirmedDate: null });
      aktionariatTxManager.save.mockRejectedValue(new Error('db down'));

      await expect(service.confirmAktionariat({ email, code, user }, rawRequest)).rejects.toThrow('db down');
    });

    it('does not fail the confirmation when the DB audit log write throws (best-effort, Error)', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();
      logService.create.mockRejectedValue(new Error('log down'));

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
      expect((service as any).logger.error).toHaveBeenCalled();
    });

    it('does not fail the confirmation when the DB audit log write rejects with a non-Error (|| fallback)', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();
      logService.create.mockRejectedValue('log string failure');

      const result = await service.confirmAktionariat({ email, code, user }, rawRequest);

      expect(result.status).toBe(RealUnitAktionariatConfirmationStatus.CONFIRMED);
    });

    it('captures the COMPLETE raw request (full URL + every query param, including extras the DTO strips) in the DB audit', async () => {
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();
      const raw = {
        url:
          '/v1/realunit/confirm-aktionariat?email=user@example.com&code=CONFIRM-CODE' +
          '&user=aktionariat-user-1&address=0xABC&foo=bar',
        query: { email, code, user, address: '0xABC', foo: 'bar' } as Record<string, unknown>,
      };

      await service.confirmAktionariat({ email, code, user }, raw);

      const audit = (logService.create as jest.Mock).mock.calls.find((c) => c[0].category === 'ServerCall')[0];
      const msg = JSON.parse(audit.message);
      // The full URL and the untouched query — including the address/foo params the typed DTO discards — are
      // recorded verbatim in the DB `log` PII store, so a per-address decision is derivable from the audit alone.
      expect(msg.rawRequest.url).toBe(raw.url);
      expect(msg.rawRequest.query).toEqual({ email, code, user, address: '0xABC', foo: 'bar' });
    });

    it('never leaks the raw request query (extra mail-link params) into the redacted Loki lines', async () => {
      mockEnvironment = 'prd';
      mockRegisteredWallets([walletA]);
      mockActiveRegistration();
      httpService.getRaw.mockResolvedValue({ status: 200, data: { status: 200, message: 'ok' } } as any);
      const secretAddress = '0xDEADBEEFcafe';
      const raw = {
        url: `/v1/realunit/confirm-aktionariat?email=user@example.com&code=CONFIRM-CODE&user=aktionariat-user-1&address=${secretAddress}`,
        query: { email, code, user, address: secretAddress } as Record<string, unknown>,
      };

      await service.confirmAktionariat({ email, code, user }, raw);

      // The DB audit carries the full raw request (the PII store)...
      const audit = (logService.create as jest.Mock).mock.calls.find((c) => c[0].category === 'ServerCall')[0];
      expect(JSON.parse(audit.message).rawRequest.query.address).toBe(secretAddress);
      // ...but the Loki channel (this.logger.*) must never see the raw query.
      const lokiText = [
        ...(service as any).logger.info.mock.calls,
        ...(service as any).logger.warn.mock.calls,
        ...(service as any).logger.error.mock.calls,
      ]
        .flat()
        .join(' ');
      expect(lokiText).not.toContain(secretAddress);
    });
  });

  describe('validateRegistrationDto (real EIP-712 verification + field matching)', () => {
    // Hardhat test accounts — synthetic keys, never real user wallets.
    const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
    const otherWallet = new Wallet('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a');

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

    // The service accepts registrationDate === today OR yesterday (UTC); mirror that here
    // (UTC, date-only) so the fixtures track the wall clock.
    const isoDay = (offsetDays: number): string =>
      new Date(Date.now() + offsetDays * 86_400_000).toISOString().split('T')[0];
    const todayIso = isoDay(0);
    const yesterdayIso = isoDay(-1);
    const tomorrowIso = isoDay(1);

    const humanFields = (overrides: Record<string, unknown> = {}): any => ({
      email: 'erika@example.com',
      name: 'Erika Mueller',
      type: RealUnitUserType.HUMAN,
      phoneNumber: '+41790000000',
      birthday: '1990-01-01',
      nationality: 'CH',
      addressStreet: 'Bahnhofstrasse 1',
      addressPostalCode: '8001',
      addressCity: 'Zurich',
      addressCountry: 'CH',
      swissTaxResidence: true,
      registrationDate: todayIso,
      walletAddress: wallet.address,
      ...overrides,
    });

    const orgFields = (overrides: Record<string, unknown> = {}): any =>
      humanFields({
        name: 'ACME AG',
        type: RealUnitUserType.CORPORATION,
        addressStreet: 'Industriestrasse 5',
        addressPostalCode: '8005',
        addressCity: 'Zurich',
        addressCountry: 'CH',
        ...overrides,
      });

    const humanKyc = (): any => ({
      accountType: AccountType.PERSONAL,
      firstName: 'Erika',
      lastName: 'Mueller',
      address: { street: 'Bahnhofstrasse', houseNumber: '1' },
    });

    const orgKyc = (): any => ({
      accountType: AccountType.ORGANIZATION,
      organizationName: 'ACME AG',
      organizationAddress: {
        street: 'Industriestrasse',
        houseNumber: '5',
        zip: '8005',
        city: 'Zurich',
        country: { id: 42 },
      },
    });

    const buildDto = async (fields: any, kycData: any, signer = wallet): Promise<any> => {
      const signature = await signer._signTypedData(domain, types, fields);
      return { ...fields, signature, lang: 'DE', kycData };
    };

    beforeEach(() => {
      (service as any).countryService.getCountry = jest.fn().mockResolvedValue({ symbol: 'CH' });
    });

    it('throws BadRequestException when the signature does not belong to the claimed wallet', async () => {
      // valid signature, but produced by a different wallet than the claimed walletAddress
      const dto = await buildDto(humanFields(), humanKyc(), otherWallet);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('resolves when the registration date is today', async () => {
      const dto = await buildDto(humanFields({ registrationDate: todayIso }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('resolves when the registration date is yesterday (UTC midnight round-trip tolerance)', async () => {
      const dto = await buildDto(humanFields({ registrationDate: yesterdayIso }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('throws BadRequestException when the registration date is in the future (tomorrow)', async () => {
      const dto = await buildDto(humanFields({ registrationDate: tomorrowIso }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the registration date is older than yesterday', async () => {
      const dto = await buildDto(humanFields({ registrationDate: '2020-01-01' }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException on an unparseable birthday', async () => {
      const dto = await buildDto(humanFields({ birthday: 'not-a-date' }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the birthday is in the future', async () => {
      const dto = await buildDto(humanFields({ birthday: '2999-01-01' }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the birthday is more than 140 years ago', async () => {
      const dto = await buildDto(humanFields({ birthday: '1800-01-01' }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when an ORGANIZATION account is not typed CORPORATION', async () => {
      const dto = await buildDto(orgFields({ type: RealUnitUserType.HUMAN }), orgKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the organization name does not match the signed name', async () => {
      const kyc = orgKyc();
      kyc.organizationName = 'Other AG';
      const dto = await buildDto(orgFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the organization street+houseNumber does not match', async () => {
      const kyc = orgKyc();
      kyc.organizationAddress.street = 'Wrongstrasse';
      const dto = await buildDto(orgFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the organization zip does not match', async () => {
      const kyc = orgKyc();
      kyc.organizationAddress.zip = '0000';
      const dto = await buildDto(orgFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the organization city does not match', async () => {
      const kyc = orgKyc();
      kyc.organizationAddress.city = 'Wrongtown';
      const dto = await buildDto(orgFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the organization country does not match the signed country', async () => {
      (service as any).countryService.getCountry.mockResolvedValue({ symbol: 'DE' });
      const dto = await buildDto(orgFields(), orgKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('passes for a valid ORGANIZATION registration (all fields match)', async () => {
      const dto = await buildDto(orgFields(), orgKyc());
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('passes for a valid ORGANIZATION registration without an org house number (street only)', async () => {
      const kyc = orgKyc();
      kyc.organizationAddress = { street: 'Industriestrasse 5', zip: '8005', city: 'Zurich', country: { id: 42 } };
      const dto = await buildDto(orgFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('throws BadRequestException when a HUMAN account is not typed HUMAN', async () => {
      const dto = await buildDto(humanFields({ type: RealUnitUserType.CORPORATION }), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the personal name does not match the signed name', async () => {
      const kyc = humanKyc();
      kyc.firstName = 'Wrong';
      const dto = await buildDto(humanFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when the personal street does not match', async () => {
      const kyc = humanKyc();
      kyc.address.street = 'Wrongstrasse';
      const dto = await buildDto(humanFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
    });

    it('passes for a valid HUMAN registration (all fields match)', async () => {
      const dto = await buildDto(humanFields(), humanKyc());
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('passes for a valid HUMAN registration without a house number (street only)', async () => {
      const kyc = humanKyc();
      kyc.address = { street: 'Bahnhofstrasse 1' };
      const dto = await buildDto(humanFields(), kyc);
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    // --- Tax residence must cover the residence (address) country ---
    // countryAndTINs is NOT part of the EIP-712 envelope — attach it AFTER signing.
    //
    // Scenario matrix (service-level validateRegistrationDto):
    //   S1 CH + swissTaxResidence, countryAndTINs undefined/empty → PASS
    //   S2 DE + DE TIN                                         → PASS
    //   S3 CH + swissTaxResidence + additional FR TIN          → PASS
    //   S4 DE + swissTaxResidence + DE TIN                     → PASS
    //   S5 DE + multi (DE, FR, US) TINs                        → PASS
    //   N1 DE + swissTaxResidence, no countryAndTINs           → reject (must include DE)
    //   N2 DE + only FR TIN                                    → reject
    //   N3 CH + !swissTaxResidence + only FR                   → reject (CH not covered)
    //   N4 duplicate countries in countryAndTINs               → reject

    const attachTins = (dto: any, countryAndTINs: { country: string; tin: string }[] | undefined) => {
      dto.countryAndTINs = countryAndTINs;
      return dto;
    };

    it('S1: passes when CH residence is covered by swissTaxResidence alone (countryAndTINs undefined)', async () => {
      const dto = await buildDto(humanFields({ addressCountry: 'CH', swissTaxResidence: true }), humanKyc());
      // no countryAndTINs attached
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('S1: passes when CH residence is covered by swissTaxResidence alone (countryAndTINs empty)', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'CH', swissTaxResidence: true }), humanKyc()),
        [],
      );
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('S2: passes when a DE residence is covered by a DE countryAndTINs entry', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        [{ country: 'DE', tin: 'DE123456789' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('S3: passes when a CH residence is covered and an additional FR tax country is declared', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'CH', swissTaxResidence: true }), humanKyc()),
        [{ country: 'FR', tin: 'FR111111111' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('S4: passes when a DE residence is covered by DE TIN even with swissTaxResidence true', async () => {
      // Living in DE requires DE among tax residences; swissTaxResidence alone does NOT cover DE.
      // With both flags set correctly (swiss + DE TIN) the registration is valid.
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: true }), humanKyc()),
        [{ country: 'DE', tin: 'DE123456789' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('S5: passes when a DE residence is covered and multiple additional tax countries are declared', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        [
          { country: 'DE', tin: 'DE123456789' },
          { country: 'FR', tin: 'FR111111111' },
          { country: 'US', tin: 'US999999999' },
        ],
      );
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('passes when a DE residence is covered and an additional AT tax country is declared (extra multi-residency)', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: true }), humanKyc()),
        [
          { country: 'DE', tin: 'DE123456789' },
          { country: 'AT', tin: 'AT987654321' },
        ],
      );
      await expect((service as any).validateRegistrationDto(dto)).resolves.toBeUndefined();
    });

    it('N1: throws when a DE residence has only swissTaxResidence and no DE countryAndTINs entry', async () => {
      const dto = await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: true }), humanKyc());
      // countryAndTINs intentionally omitted — DE address must still appear among tax residences
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(
        /Tax residence must include the residence country \(DE\)/,
      );
    });

    it('N2: throws when a DE residence is missing from the declared tax residences (only FR)', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        [{ country: 'FR', tin: 'FR111111111' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(
        /Tax residence must include the residence country \(DE\)/,
      );
    });

    it('N3: throws when a CH residence is not covered (swissTaxResidence false, only FR)', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'CH', swissTaxResidence: false }), humanKyc()),
        [{ country: 'FR', tin: 'FR111111111' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(
        /Tax residence must include the residence country \(CH\)/,
      );
    });

    it('N4: throws when countryAndTINs contains duplicate countries', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        [
          { country: 'DE', tin: 'DE111' },
          { country: 'DE', tin: 'DE222' },
        ],
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(BadRequestException);
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(
        /countryAndTINs must not contain duplicate countries/,
      );
    });

    it('N5: throws when CH appears in countryAndTINs (must use swissTaxResidence instead)', async () => {
      // CH address covered only via countryAndTINs.CH would bypass the swissTaxResidence flag.
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'CH', swissTaxResidence: false }), humanKyc()),
        [{ country: 'CH', tin: 'should-not-be-here' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(/countryAndTINs must not include CH/);
    });

    it('N6: throws when a multi-residence TIN entry has an empty tin (even with swissTaxResidence true)', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'CH', swissTaxResidence: true }), humanKyc()),
        [{ country: 'FR', tin: '   ' }],
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(
        /countryAndTINs.tin must be a non-empty string/,
      );
    });

    // --- F1/F3 defense-in-depth bounds on countryAndTINs (fail closed before forward) ---

    it('F1: rejects countryAndTINs whose serialized length exceeds MAX_SERIALIZED_TIN_LENGTH', async () => {
      // Under the DTO bounds the worst-case serialization is ~890 chars; the serialized-length
      // check is a fail-closed safety net for constant drift. Force it by stubbing serialize.
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        [{ country: 'DE', tin: 'DE123456789' }],
      );
      jest.spyOn(service as any, 'serializeCountryAndTins').mockReturnValue('x'.repeat(1025));
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(/countryAndTINs is too large/);
    });

    it('F1: rejects more than 10 countryAndTINs entries at the service layer', async () => {
      const countries = ['DE', 'FR', 'US', 'AT', 'IT', 'ES', 'NL', 'BE', 'PT', 'IE', 'PL'];
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        countries.map((country, i) => ({ country, tin: `TIN${i}` })),
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(/more than 10 entries/);
    });

    it('F1: rejects a TIN longer than 64 characters at the service layer', async () => {
      const dto = attachTins(
        await buildDto(humanFields({ addressCountry: 'DE', swissTaxResidence: false }), humanKyc()),
        [{ country: 'DE', tin: 'x'.repeat(65) }],
      );
      await expect((service as any).validateRegistrationDto(dto)).rejects.toThrow(/must not exceed 64 characters/);
    });

    it('F3: rejects a non-array countryAndTINs with BadRequestException (not TypeError)', () => {
      for (const countryAndTINs of ['pwned', { a: 1 }, 42] as any[]) {
        expect(() =>
          (service as any).validateTaxResidenceCoversAddress({
            swissTaxResidence: true,
            addressCountry: 'CH',
            countryAndTINs,
          }),
        ).toThrow(BadRequestException);
        expect(() =>
          (service as any).validateTaxResidenceCoversAddress({
            swissTaxResidence: true,
            addressCountry: 'CH',
            countryAndTINs,
          }),
        ).toThrow(/countryAndTINs must be an array/);
      }
    });

    it('resolveSignedRegistrationMessage normalizes a signature that lacks the 0x prefix', async () => {
      const fields = humanFields();
      const signature = await wallet._signTypedData(domain, types, fields);
      const dto = { ...fields, signature: signature.slice(2), lang: 'DE', kycData: {} };
      const message = (service as any).resolveSignedRegistrationMessage(dto);
      expect(message).toBeDefined();
      expect(message.walletAddress).toBe(wallet.address);
    });
  });

  describe('registerEmail (email registration step)', () => {
    const dto: any = { email: 'user@example.com' };
    let getActiveUserData: jest.Mock;
    let trySetUserMail: jest.Mock;
    let addServiceProvider: jest.Mock;
    let initializeProcess: jest.Mock;

    beforeEach(() => {
      getActiveUserData = jest.fn();
      trySetUserMail = jest.fn();
      addServiceProvider = jest.fn();
      initializeProcess = jest.fn();
      (service as any).userDataService.getActiveUserData = getActiveUserData;
      (service as any).userDataService.trySetUserMail = trySetUserMail;
      (service as any).userDataService.addServiceProvider = addServiceProvider;
      (service as any).kycService.initializeProcess = initializeProcess;
    });

    it('registers the email, initializes KYC and marks the RealUnit service provider (happy path)', async () => {
      const userData = { mail: null, kycLevel: 0 };
      getActiveUserData.mockResolvedValue(userData);

      const status = await service.registerEmail(1, dto);

      expect(status).toBe(RealUnitEmailRegistrationStatus.EMAIL_REGISTERED);
      expect(trySetUserMail).toHaveBeenCalledWith(userData, 'user@example.com');
      expect(initializeProcess).toHaveBeenCalledWith(userData);
      expect(addServiceProvider).toHaveBeenCalledWith(userData, ServiceProvider.REALUNIT);
    });

    it('skips KYC initialization when the user is already at KYC level 10 or above', async () => {
      const userData = { mail: null, kycLevel: KycLevel.LEVEL_10 };
      getActiveUserData.mockResolvedValue(userData);

      const status = await service.registerEmail(1, dto);

      expect(status).toBe(RealUnitEmailRegistrationStatus.EMAIL_REGISTERED);
      expect(initializeProcess).not.toHaveBeenCalled();
      expect(addServiceProvider).toHaveBeenCalledWith(userData, ServiceProvider.REALUNIT);
    });

    it('returns MERGE_REQUESTED when setting the mail triggers an account merge request', async () => {
      getActiveUserData.mockResolvedValue({ mail: null, kycLevel: 0 });
      trySetUserMail.mockRejectedValue(new ConflictException('account merge request sent'));

      const status = await service.registerEmail(1, dto);

      expect(status).toBe(RealUnitEmailRegistrationStatus.MERGE_REQUESTED);
      expect(addServiceProvider).not.toHaveBeenCalled();
    });

    it('rethrows a ConflictException that is not a merge request', async () => {
      getActiveUserData.mockResolvedValue({ mail: null, kycLevel: 0 });
      trySetUserMail.mockRejectedValue(new ConflictException('Account already exists'));

      await expect(service.registerEmail(1, dto)).rejects.toThrow(ConflictException);
      expect(addServiceProvider).not.toHaveBeenCalled();
    });

    it('rethrows a non-Conflict error from setting the mail', async () => {
      getActiveUserData.mockResolvedValue({ mail: null, kycLevel: 0 });
      trySetUserMail.mockRejectedValue(new Error('database unavailable'));

      await expect(service.registerEmail(1, dto)).rejects.toThrow('database unavailable');
    });

    it('accepts a matching already-verified email without re-setting the mail', async () => {
      const userData = { mail: 'user@example.com', kycLevel: KycLevel.LEVEL_10 };
      getActiveUserData.mockResolvedValue(userData);

      const status = await service.registerEmail(1, dto);

      expect(status).toBe(RealUnitEmailRegistrationStatus.EMAIL_REGISTERED);
      expect(trySetUserMail).not.toHaveBeenCalled();
      expect(addServiceProvider).toHaveBeenCalledWith(userData, ServiceProvider.REALUNIT);
    });

    it('throws BadRequestException when the submitted email does not match the verified email', async () => {
      getActiveUserData.mockResolvedValue({ mail: 'other@example.com', kycLevel: KycLevel.LEVEL_10 });

      await expect(service.registerEmail(1, dto)).rejects.toThrow(BadRequestException);
      expect(trySetUserMail).not.toHaveBeenCalled();
    });
  });

  describe('completeRegistration — tax-residence TINs (audit-safe user_data.tin persistence)', () => {
    // Data rule: never overwrite a DB value if the previous value would become unrecoverable.
    //   - New non-empty countryAndTINs → written AFTER forwardRegistration (signedPayload holds the event)
    //     with a before→after audit log.
    //   - Swiss-only / empty countryAndTINs → does NOT clear an existing non-null user_data.tin.
    // validateRegistrationDto is mocked here — tax-residence rule coverage lives in its own describe.

    const TIN_DE = { country: 'DE', tin: 'DE123456789' };
    const TIN_FR = { country: 'FR', tin: 'FR111111111' };
    const TIN_US = { country: 'US', tin: 'US999999999' };
    const STALE = JSON.stringify([{ country: 'XX', tin: 'stale' }]);

    type TinScenario = {
      id: string;
      addressCountry: string;
      swissTaxResidence: boolean;
      countryAndTINs: { country: string; tin: string }[] | undefined | [];
      /** Expected next value when previous tin is empty; null means no tin column write. */
      expectedTinWhenEmpty: string | null;
    };

    const tinScenarios: TinScenario[] = [
      {
        id: 'S1',
        addressCountry: 'CH',
        swissTaxResidence: true,
        countryAndTINs: undefined,
        expectedTinWhenEmpty: null,
      },
      {
        id: 'S1-empty',
        addressCountry: 'CH',
        swissTaxResidence: true,
        countryAndTINs: [],
        expectedTinWhenEmpty: null,
      },
      {
        id: 'S2',
        addressCountry: 'DE',
        swissTaxResidence: false,
        countryAndTINs: [TIN_DE],
        expectedTinWhenEmpty: JSON.stringify([TIN_DE]),
      },
      {
        id: 'S3',
        addressCountry: 'CH',
        swissTaxResidence: true,
        countryAndTINs: [TIN_FR],
        expectedTinWhenEmpty: JSON.stringify([TIN_FR]),
      },
      {
        id: 'S4',
        addressCountry: 'DE',
        swissTaxResidence: true,
        countryAndTINs: [TIN_DE],
        expectedTinWhenEmpty: JSON.stringify([TIN_DE]),
      },
      {
        id: 'S5',
        addressCountry: 'DE',
        swissTaxResidence: false,
        countryAndTINs: [TIN_DE, TIN_FR, TIN_US],
        expectedTinWhenEmpty: JSON.stringify([TIN_DE, TIN_FR, TIN_US]),
      },
    ];

    let forwardSpy: jest.SpyInstance;

    beforeEach(() => {
      jest.spyOn(service as any, 'validateRegistrationDto').mockResolvedValue(undefined);
      jest
        .spyOn(service as any, 'findRegistration')
        .mockResolvedValue({ registration: undefined, isForCurrentWallet: false });
      forwardSpy = jest.spyOn(service as any, 'forwardRegistration').mockResolvedValue(true);
      (service as any).countryService.getCountryWithSymbol.mockResolvedValue({ id: 1, symbol: 'CH' });
      (service as any).languageService.getLanguageBySymbol.mockResolvedValue({ id: 1, symbol: 'DE' });
      logService.create.mockResolvedValue({} as any);
    });

    const buildDto = (scenario: TinScenario): any => ({
      walletAddress: '0xabc',
      signature: '0xsig',
      email: 'max@example.com',
      kycData: { accountType: 'Personal' },
      nationality: scenario.addressCountry,
      birthday: '1990-01-01',
      lang: 'DE',
      addressCountry: scenario.addressCountry,
      swissTaxResidence: scenario.swissTaxResidence,
      countryAndTINs: scenario.countryAndTINs,
    });

    const tinUpdates = (): any[] =>
      (userDataService.updateUserDataInternal as jest.Mock).mock.calls
        .map((c) => c[1])
        .filter((u) => u && Object.prototype.hasOwnProperty.call(u, 'tin'));

    describe.each(tinScenarios)(
      '$id first-time customer (empty previous tin) — addressCountry=$addressCountry',
      (scenario) => {
        it(`forwards first, then writes tin only when non-empty (expected=${
          scenario.expectedTinWhenEmpty === null ? 'no write' : 'JSON'
        })`, async () => {
          const dto = buildDto(scenario);
          const userData: any = {
            id: 1,
            kycLevel: KycLevel.LEVEL_10,
            mail: 'max@example.com',
            firstname: null,
            tin: null,
          };
          userService.getUserByAddress.mockResolvedValue({ userData } as any);

          const status = await service.completeRegistration(1, dto);

          expect(status).toBe(RealUnitRegistrationStatus.COMPLETED);
          expect(userDataService.updatePersonalData).toHaveBeenCalledWith(userData, dto.kycData);
          // Personal-data update never includes tin (tin is written only after forward).
          const personalUpdate = (userDataService.updateUserDataInternal as jest.Mock).mock.calls[0][1];
          expect(personalUpdate).not.toHaveProperty('tin');
          expect(forwardSpy).toHaveBeenCalledWith(userData, dto);

          const tinWrites = tinUpdates();
          if (scenario.expectedTinWhenEmpty === null) {
            expect(tinWrites).toHaveLength(0);
            expect(logService.create).not.toHaveBeenCalledWith(expect.objectContaining({ subsystem: 'UserDataTin' }));
          } else {
            expect(tinWrites).toEqual([{ tin: scenario.expectedTinWhenEmpty }]);
            expect(logService.create).toHaveBeenCalledWith(
              expect.objectContaining({
                system: 'RealUnit',
                subsystem: 'UserDataTin',
                message: expect.stringContaining('"previousTin":null'),
              }),
            );
            // Audit before column write: log must be called before the tin update.
            const logOrder = (logService.create as jest.Mock).mock.invocationCallOrder.find((_, i) => {
              const arg = (logService.create as jest.Mock).mock.calls[i][0];
              return arg?.subsystem === 'UserDataTin';
            });
            const tinOrder = (userDataService.updateUserDataInternal as jest.Mock).mock.invocationCallOrder.find(
              (_, i) => {
                const arg = (userDataService.updateUserDataInternal as jest.Mock).mock.calls[i][1];
                return arg && Object.prototype.hasOwnProperty.call(arg, 'tin');
              },
            );
            expect(logOrder).toBeLessThan(tinOrder!);
          }
        });
      },
    );

    describe.each(tinScenarios)(
      '$id existing personal data with stale tin — addressCountry=$addressCountry',
      (scenario) => {
        it('never destroys the previous non-null tin without a recoverable replacement', async () => {
          const dto = buildDto(scenario);
          const userData: any = {
            id: 1,
            kycLevel: KycLevel.LEVEL_10,
            mail: 'max@example.com',
            firstname: 'Max',
            tin: STALE,
          };
          userService.getUserByAddress.mockResolvedValue({ userData } as any);
          jest.spyOn(service as any, 'isPersonalDataMatching').mockReturnValue(true);

          const status = await service.completeRegistration(1, dto);

          expect(status).toBe(RealUnitRegistrationStatus.COMPLETED);
          expect(userDataService.updatePersonalData).not.toHaveBeenCalled();
          expect(forwardSpy).toHaveBeenCalledWith(userData, dto);

          const tinWrites = tinUpdates();
          if (scenario.expectedTinWhenEmpty === null) {
            // Swiss-only must NOT clear STALE — that would lose data not on the new payload.
            expect(tinWrites).toHaveLength(0);
          } else {
            // Non-empty next set: overwrite after audit (new value also on signedPayload).
            expect(tinWrites).toEqual([{ tin: scenario.expectedTinWhenEmpty }]);
            const audit = (logService.create as jest.Mock).mock.calls.find(
              (c) => c[0]?.subsystem === 'UserDataTin',
            )?.[0];
            expect(audit).toBeDefined();
            const body = JSON.parse(audit.message);
            expect(body.previousTin).toBe(STALE);
            expect(body.nextTin).toBe(scenario.expectedTinWhenEmpty);
          }
        });
      },
    );

    it('fails closed: does not overwrite tin when the before→after audit log cannot be written', async () => {
      const dto = buildDto(tinScenarios.find((s) => s.id === 'S2')!);
      const userData: any = {
        id: 1,
        kycLevel: KycLevel.LEVEL_10,
        mail: 'max@example.com',
        firstname: 'Max',
        tin: STALE,
      };
      userService.getUserByAddress.mockResolvedValue({ userData } as any);
      jest.spyOn(service as any, 'isPersonalDataMatching').mockReturnValue(true);
      logService.create.mockRejectedValue(new Error('log down'));

      await expect(service.completeRegistration(1, dto)).rejects.toThrow('log down');
      // Registration forward already ran, but the column must not change without audit.
      expect(tinUpdates()).toHaveLength(0);
    });
  });

  describe('toUserDataDto (returns undefined without registration data)', () => {
    it('returns undefined when there is no registration', () => {
      expect((service as any).toUserDataDto(undefined)).toBeUndefined();
    });

    it('returns undefined when the registration has no signed payload', () => {
      expect((service as any).toUserDataDto({ signedPayloadData: undefined })).toBeUndefined();
    });
  });

  describe('toUserDataDtoFromUserData (nullish fallbacks + organization prefill)', () => {
    it('maps a fully populated organization user (set side of every fallback + org address branch)', () => {
      const userData: any = {
        firstname: 'Erika',
        surname: 'Mueller',
        mail: 'erika@example.com',
        naturalPersonName: 'Erika Mueller',
        phone: '+41790000000',
        birthday: new Date('1990-01-01T00:00:00.000Z'),
        nationality: { symbol: 'CH' },
        street: 'Bahnhofstrasse',
        houseNumber: '1',
        location: 'Zurich',
        zip: '8001',
        country: { symbol: 'CH' },
        language: { symbol: 'de' },
        accountType: AccountType.ORGANIZATION,
        tin: JSON.stringify([{ country: 'DE', tin: '12345' }]),
        organizationName: 'ACME AG',
        organizationStreet: 'Industriestrasse',
        organizationHouseNumber: '5',
        organizationLocation: 'Zug',
        organizationZip: '6300',
        organizationCountry: { symbol: 'CH', id: 3 },
      };

      const dto = (service as any).toUserDataDtoFromUserData(userData);

      expect(dto.email).toBe('erika@example.com');
      expect(dto.name).toBe('Erika Mueller');
      expect(dto.phoneNumber).toBe('+41790000000');
      expect(dto.birthday).toBe('1990-01-01');
      expect(dto.nationality).toBe('CH');
      expect(dto.addressStreet).toBe('Bahnhofstrasse 1');
      expect(dto.addressPostalCode).toBe('8001');
      expect(dto.addressCity).toBe('Zurich');
      expect(dto.addressCountry).toBe('CH');
      expect(dto.swissTaxResidence).toBe(true);
      expect(dto.lang).toBe(RealUnitLanguage.DE);
      expect(dto.countryAndTINs).toEqual([{ country: 'DE', tin: '12345' }]);
      expect(dto.kycData.accountType).toBe(AccountType.ORGANIZATION);
      expect(dto.kycData.organizationName).toBe('ACME AG');
      expect(dto.kycData.organizationAddress).toEqual({
        street: 'Industriestrasse',
        houseNumber: '5',
        city: 'Zug',
        zip: '6300',
        country: { symbol: 'CH', id: 3 },
      });
    });

    it('falls back to empty strings/defaults when the optional fields are absent (null side)', () => {
      const userData: any = { firstname: 'Solo', surname: null };

      const dto = (service as any).toUserDataDtoFromUserData(userData);

      expect(dto.email).toBe('');
      expect(dto.name).toBe('');
      expect(dto.phoneNumber).toBe('');
      expect(dto.birthday).toBe('');
      expect(dto.nationality).toBe('');
      expect(dto.addressStreet).toBe('');
      expect(dto.addressPostalCode).toBe('');
      expect(dto.addressCity).toBe('');
      expect(dto.addressCountry).toBe('');
      expect(dto.swissTaxResidence).toBe(false);
      expect(dto.lang).toBe(RealUnitLanguage.EN);
      expect(dto.countryAndTINs).toBeUndefined();
      expect(dto.kycData.accountType).toBe(AccountType.PERSONAL);
      expect(dto.kycData.firstName).toBe('Solo');
      expect(dto.kycData.lastName).toBe('');
      expect(dto.kycData.organizationName).toBeUndefined();
      expect(dto.kycData.organizationAddress).toBeUndefined();
    });

    it('builds the organization address with empty inner fields when the org detail columns are null', () => {
      const userData: any = { firstname: null, surname: 'OnlySurname', organizationCountry: { symbol: 'CH', id: 7 } };

      const dto = (service as any).toUserDataDtoFromUserData(userData);

      expect(dto.kycData.firstName).toBe('');
      expect(dto.kycData.lastName).toBe('OnlySurname');
      expect(dto.kycData.organizationName).toBeUndefined();
      expect(dto.kycData.organizationAddress).toEqual({
        street: '',
        houseNumber: undefined,
        city: '',
        zip: '',
        country: { symbol: 'CH', id: 7 },
      });
    });

    // F4: malformed / contract-violating user_data.tin must degrade the prefill loudly, never throw.
    it('F4: degrades prefill to empty countryAndTINs when tin is not valid JSON', () => {
      const userData: any = { id: 99, firstname: 'Erika', tin: 'not json' };
      const dto = (service as any).toUserDataDtoFromUserData(userData);
      expect(dto).toBeDefined();
      expect(dto.countryAndTINs).toBeUndefined();
      expect((service as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'));
    });

    it('F4: degrades prefill to empty countryAndTINs when tin is a non-array JSON value', () => {
      const userData: any = { id: 99, firstname: 'Erika', tin: '{"a":1}' };
      const dto = (service as any).toUserDataDtoFromUserData(userData);
      expect(dto).toBeDefined();
      expect(dto.countryAndTINs).toBeUndefined();
      expect((service as any).logger.error).toHaveBeenCalledWith(expect.stringContaining('not an array'));
    });

    it('F4: drops a contract-violating CH entry from the prefill without throwing', () => {
      const userData: any = { id: 99, firstname: 'Erika', tin: '[{"country":"CH","tin":"x"}]' };
      const dto = (service as any).toUserDataDtoFromUserData(userData);
      expect(dto).toBeDefined();
      expect(dto.countryAndTINs).toBeUndefined();
      expect((service as any).logger.error).toHaveBeenCalledWith(
        expect.stringContaining('violating the registration contract'),
      );
    });
  });

  describe('isPersonalDataMatching (organization account branch)', () => {
    const orgUserData = (): any => ({
      firstname: 'Erika',
      surname: 'Mueller',
      phone: '+41790000000',
      accountType: AccountType.ORGANIZATION,
      street: 'Bahnhofstrasse',
      houseNumber: '1',
      location: 'Zurich',
      zip: '8001',
      country: { id: 10 },
      nationality: { symbol: 'CH' },
      birthday: new Date('1990-01-01T00:00:00.000Z'),
      organizationName: 'ACME AG',
      organizationStreet: 'Industriestrasse',
      organizationHouseNumber: '5',
      organizationLocation: 'Zug',
      organizationZip: '6300',
      organizationCountry: { id: 20 },
    });

    const orgDto = (): any => ({
      nationality: 'CH',
      birthday: '1990-01-01',
      kycData: {
        firstName: 'Erika',
        lastName: 'Mueller',
        phone: '+41790000000',
        accountType: AccountType.ORGANIZATION,
        address: { street: 'Bahnhofstrasse', houseNumber: '1', city: 'Zurich', zip: '8001', country: { id: 10 } },
        organizationName: 'ACME AG',
        organizationAddress: {
          street: 'Industriestrasse',
          houseNumber: '5',
          city: 'Zug',
          zip: '6300',
          country: { id: 20 },
        },
      },
    });

    it('returns true when all organization fields match', () => {
      expect((service as any).isPersonalDataMatching(orgUserData(), orgDto())).toBe(true);
    });

    it('returns false when the organization name differs', () => {
      const dto = orgDto();
      dto.kycData.organizationName = 'Other AG';
      expect((service as any).isPersonalDataMatching(orgUserData(), dto)).toBe(false);
    });

    it('returns false when the organization street differs', () => {
      const dto = orgDto();
      dto.kycData.organizationAddress.street = 'Wrongstrasse';
      expect((service as any).isPersonalDataMatching(orgUserData(), dto)).toBe(false);
    });

    it('returns false when the organization house number differs', () => {
      const dto = orgDto();
      dto.kycData.organizationAddress.houseNumber = '9';
      expect((service as any).isPersonalDataMatching(orgUserData(), dto)).toBe(false);
    });

    it('returns false when the organization city differs', () => {
      const dto = orgDto();
      dto.kycData.organizationAddress.city = 'Wrongtown';
      expect((service as any).isPersonalDataMatching(orgUserData(), dto)).toBe(false);
    });

    it('returns false when the organization zip differs', () => {
      const dto = orgDto();
      dto.kycData.organizationAddress.zip = '0000';
      expect((service as any).isPersonalDataMatching(orgUserData(), dto)).toBe(false);
    });

    it('returns false when the organization country differs', () => {
      const dto = orgDto();
      dto.kycData.organizationAddress.country = { id: 99 };
      expect((service as any).isPersonalDataMatching(orgUserData(), dto)).toBe(false);
    });

    it('returns true when neither side carries organization detail (null org fields match via ?? null)', () => {
      const userData = orgUserData();
      userData.organizationName = null;
      userData.organizationStreet = null;
      userData.organizationHouseNumber = null;
      userData.organizationLocation = null;
      userData.organizationZip = null;
      userData.organizationCountry = null;
      const dto = orgDto();
      dto.kycData.organizationName = undefined;
      dto.kycData.organizationAddress = undefined;
      expect((service as any).isPersonalDataMatching(userData, dto)).toBe(true);
    });
  });

  describe('getRegisteredWalletAddresses (skips rows without a resolvable wallet address)', () => {
    it('skips a row whose signed payload and column both lack a wallet address', async () => {
      const validAddress = '0xAbCdef0000000000000000000000000000000001';
      aktionariatRegistrationRepo.find.mockResolvedValue([
        { signedPayloadData: undefined, walletAddress: null },
        { signedPayloadData: { walletAddress: validAddress }, walletAddress: null },
      ] as any);

      const result = await (service as any).getRegisteredWalletAddresses('user@example.com');

      expect(result).toEqual([validAddress]);
    });
  });
});
