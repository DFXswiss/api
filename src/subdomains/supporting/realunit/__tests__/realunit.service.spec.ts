import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ethers } from 'ethers';
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
import { SwapService } from 'src/subdomains/core/buy-crypto/routes/swap/swap.service';
import { PaymentLinkPaymentStatus } from 'src/subdomains/core/payment-link/enums';
import { SellService } from 'src/subdomains/core/sell-crypto/route/sell.service';
import { LnUrlForwardService } from 'src/subdomains/generic/forwarding/services/lnurl-forward.service';
import { KycService } from 'src/subdomains/generic/kyc/services/kyc.service';
import { AccountMergeService } from 'src/subdomains/generic/user/models/account-merge/account-merge.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { AssetPricesService } from '../../pricing/services/asset-prices.service';
import { PricingService } from '../../pricing/services/pricing.service';
import { RealUnitRegistrationState, RealUnitRegistrationStatus } from '../dto/realunit-registration.dto';
import { RealUnitDevService } from '../realunit-dev.service';
import { RealUnitService } from '../realunit.service';

// Mutable so individual tests can switch between the testnet (loc → Sepolia) and mainnet (prd → Ethereum)
// token-blockchain branches the service derives at construction time.
let mockEnvironment = 'loc';

jest.mock('src/config/config', () => ({
  get Config() {
    return { environment: mockEnvironment };
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
  let swapService: jest.Mocked<SwapService>;
  let userService: jest.Mocked<UserService>;
  let kycService: jest.Mocked<KycService>;
  let lnUrlForwardService: jest.Mocked<LnUrlForwardService>;
  let faucetRequestService: jest.Mocked<FaucetRequestService>;

  const evmClient = {
    chainId: 11155111,
    getTransactionCount: jest.fn(),
    getRecommendedGasPrice: jest.fn(),
    getNativeCoinBalanceForAddress: jest.fn(),
    sendSignedTransaction: jest.fn(),
  };

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
          provide: SwapService,
          useValue: {
            createSwapPaymentInfo: jest.fn(),
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
        { provide: FaucetRequestService, useValue: { resetFaucet: jest.fn() } },
        { provide: EthereumService, useValue: { getDefaultClient: jest.fn().mockReturnValue(evmClient) } },
        { provide: SepoliaService, useValue: { getDefaultClient: jest.fn().mockReturnValue(evmClient) } },
        {
          provide: LnUrlForwardService,
          useValue: {
            lnurlpCallbackForward: jest.fn(),
            txHexForward: jest.fn(),
            waitForPayment: jest.fn(),
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
    kycService = module.get(KycService);
    lnUrlForwardService = module.get(LnUrlForwardService);
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
    const mockRequest = { id: 1, isValid: true, amount: 10, routeId: 5, user: { address: userAddress } };

    beforeEach(() => {
      evmClient.getTransactionCount.mockResolvedValue(7);
      evmClient.getRecommendedGasPrice.mockResolvedValue(ethers.BigNumber.from(1_000_000_000));
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(1);
    });

    it('should build the swap tx without a deposit leg', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValue(realuTxAsset);

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

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if ETH balance is insufficient for gas', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValue(realuTxAsset);
      evmClient.getNativeCoinBalanceForAddress.mockResolvedValue(0);

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if the REALU asset has no contract address', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      assetService.getAssetByQuery.mockResolvedValue(createCustomAsset({ name: 'REALU', chainId: undefined } as any));

      await expect(service.createSwapUnsignedTransaction(42, 1)).rejects.toThrow(BadRequestException);
    });

    it('should default REALU decimals to 18 when the asset has no decimals set', async () => {
      // decimals null/undefined exercises the `?? 18` fallback in buildSwapUnsignedTransaction
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      const noDecimalsAsset = createCustomAsset({ name: 'REALU', chainId: realuContract, decimals: undefined } as any);
      assetService.getAssetByQuery.mockResolvedValue(noDecimalsAsset);

      const result = await service.createSwapUnsignedTransaction(42, 1);

      // request amount 10 -> 10 shares encoded with 18 decimals = 10e18
      const parsed = ethers.utils.parseTransaction(result.swap);
      const iface = new ethers.utils.Interface([
        'function transferAndCall(address to, uint256 value, bytes data) returns (bool)',
      ]);
      const [, value] = iface.decodeFunctionData('transferAndCall', parsed.data);
      expect(value.toString()).toBe(ethers.utils.parseUnits('10', 18).toString());
    });
  });

  describe('getSwapPaymentInfo', () => {
    const walletAddress = '0x4444444444444444444444444444444444444444';

    function buildUser(opts: { kycLevel?: number; registered?: boolean } = {}): any {
      const steps =
        (opts.registered ?? true) ? [{ isFailed: false, isCanceled: false, getResult: () => ({ walletAddress }) }] : [];
      return {
        id: 42,
        address: walletAddress,
        userData: {
          kycLevel: opts.kycLevel ?? 30,
          getStepsWith: jest.fn().mockReturnValue(steps),
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
      await expect(service.getSwapPaymentInfo(buildUser({ registered: false }), { amount: 10 } as any)).rejects.toThrow(
        ForbiddenException,
      );
      expect(swapService.createSwapPaymentInfo).not.toHaveBeenCalled();
    });

    it('should require KYC Level 30', async () => {
      await expect(service.getSwapPaymentInfo(buildUser({ kycLevel: 20 }), { amount: 10 } as any)).rejects.toThrow(
        ForbiddenException,
      );
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
      expect(result.estimatedAmount).toBe(0.38);
      expect(transactionRequestService.updateEstimatedAmount).not.toHaveBeenCalled();
    });

    it('should fall back to the SwapService estimate when the brokerbot price query fails', async () => {
      // the brokerbot lookup rejects -> .catch(() => null) -> estimate is not re-anchored
      swapService.createSwapPaymentInfo.mockResolvedValue(swapInfo as any);
      blockchainService.getBrokerbotSellPrice.mockRejectedValue(new Error('rpc down'));

      const result = await service.getSwapPaymentInfo(buildUser(), { amount: 10 } as any);

      expect(result.estimatedAmount).toBe(950);
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
    const mockRequest = { id: 1, isValid: true, amount: 10, routeId: 7, user: { address: userAddress } };

    const unsignedTx = ethers.utils.serializeTransaction({
      type: 2,
      chainId: 11155111,
      nonce: 7,
      maxPriorityFeePerGas: ethers.BigNumber.from(1),
      maxFeePerGas: ethers.BigNumber.from(1),
      gasLimit: ethers.BigNumber.from(350_000),
      to: realuContract,
      value: ethers.BigNumber.from(0),
      data: '0x',
      accessList: [],
    });

    const broadcastDto = {
      unsignedTx,
      r: '0x' + '1'.repeat(64),
      s: '0x' + '2'.repeat(64),
      v: 27,
    };

    it('should reconstruct the signed hex, broadcast it and return the txHash', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      evmClient.sendSignedTransaction.mockResolvedValue({ response: { hash: '0xSwapTxHash' } });

      const result = await service.broadcastSwapTransaction(42, 1, broadcastDto);

      expect(result.txHash).toBe('0xSwapTxHash');
      expect(evmClient.sendSignedTransaction).toHaveBeenCalledTimes(1);
      expect(evmClient.sendSignedTransaction.mock.calls[0][0]).toMatch(/^0x/);
    });

    it('should throw BadRequestException if the request is not valid', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue({ ...mockRequest, isValid: false } as any);

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(evmClient.sendSignedTransaction).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the broadcast returns an error', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      evmClient.sendSignedTransaction.mockResolvedValue({ error: { message: 'nonce too low' } });

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(faucetRequestService.resetFaucet).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when the broadcast returns no transaction hash', async () => {
      transactionRequestService.getOrThrow.mockResolvedValue(mockRequest as any);
      evmClient.sendSignedTransaction.mockResolvedValue({ response: {} });

      await expect(service.broadcastSwapTransaction(42, 1, broadcastDto)).rejects.toThrow(BadRequestException);
      expect(faucetRequestService.resetFaucet).not.toHaveBeenCalled();
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

      const unsignedTx = ethers.utils.serializeTransaction({
        type: 2,
        chainId: 1,
        nonce: 1,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(100_000),
        to: zchfTxAsset.chainId,
        value: ethers.BigNumber.from(0),
        data: '0x',
        accessList: [],
      });

      const result = await service.submitOcpPay({
        paymentLinkId: 'pl_abc',
        quoteId: 'quote_xyz',
        unsignedTx,
        r: '0x' + '1'.repeat(64),
        s: '0x' + '2'.repeat(64),
        v: 27,
      });

      expect(result.txId).toBe('0xTxId');
      expect(lnUrlForwardService.txHexForward).toHaveBeenCalledWith(
        'pl_abc',
        expect.objectContaining({ method: Blockchain.ETHEREUM, asset: 'ZCHF', quote: 'quote_xyz' }),
      );
      expect(lnUrlForwardService.txHexForward.mock.calls[0][1].hex).toMatch(/^0x/);
    });
  });

  describe('getOcpPayStatus', () => {
    it('should map the lnurlp wait status', async () => {
      lnUrlForwardService.waitForPayment.mockResolvedValue({ status: PaymentLinkPaymentStatus.COMPLETED });

      const result = await service.getOcpPayStatus('pl_abc');

      expect(result).toEqual({ status: PaymentLinkPaymentStatus.COMPLETED });
      expect(lnUrlForwardService.waitForPayment).toHaveBeenCalledWith('pl_abc');
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

      const unsignedTx = ethers.utils.serializeTransaction({
        type: 2,
        chainId: 11155111,
        nonce: 1,
        maxPriorityFeePerGas: ethers.BigNumber.from(1),
        maxFeePerGas: ethers.BigNumber.from(1),
        gasLimit: ethers.BigNumber.from(100_000),
        to: zchfTxAsset.chainId,
        value: ethers.BigNumber.from(0),
        data: '0x',
        accessList: [],
      });

      const result = await service.submitOcpPay({
        paymentLinkId: 'pl_abc',
        quoteId: 'quote_xyz',
        unsignedTx,
        r: '0x' + '1'.repeat(64),
        s: '0x' + '2'.repeat(64),
        v: 27,
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
