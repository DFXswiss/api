import { Test, TestingModule } from '@nestjs/testing';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { BuyCryptoRepository } from 'src/subdomains/core/buy-crypto/process/repositories/buy-crypto.repository';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BankTxService } from '../../bank-tx/bank-tx/services/bank-tx.service';
import { BankService } from '../../bank/bank/bank.service';
import { TransactionRequestStatus, TransactionRequestType } from '../../payment/entities/transaction-request.entity';
import { TransactionRequestRepository } from '../../payment/repositories/transaction-request.repository';
import { SpecialExternalAccountService } from '../../payment/services/special-external-account.service';
import { TransactionService } from '../../payment/services/transaction.service';
import { RealUnitDevService } from '../realunit-dev.service';

// Mock environment - must be declared before jest.mock since mocks are hoisted
// Use a global variable that can be mutated
(global as any).__mockEnvironment = 'loc';

jest.mock('src/config/config', () => ({
  get Config() {
    return { environment: (global as any).__mockEnvironment };
  },
  Environment: {
    LOC: 'loc',
    DEV: 'dev',
    PRD: 'prd',
  },
  GetConfig: jest.fn(() => ({
    blockchain: {
      ethereum: { ethChainId: 1 },
      sepolia: { sepoliaChainId: 11155111 },
      arbitrum: { arbitrumChainId: 42161 },
      optimism: { optimismChainId: 10 },
      polygon: { polygonChainId: 137 },
      base: { baseChainId: 8453 },
      gnosis: { gnosisChainId: 100 },
      bsc: { bscChainId: 56 },
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
    kyc: {
      mandator: 'DFX',
      prefix: 'DFX',
    },
    defaults: {
      language: 'EN',
      currency: 'CHF',
    },
  })),
}));

// Mock DfxLogger
jest.mock('src/shared/services/dfx-logger', () => ({
  DfxLogger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock Lock decorator
jest.mock('src/shared/utils/lock', () => ({
  Lock: () => () => {},
}));

// Mock Util
jest.mock('src/shared/utils/util', () => ({
  Util: {
    createUid: jest.fn().mockReturnValue('MOCK-UID'),
  },
}));

describe('RealUnitDevService', () => {
  let service: RealUnitDevService;
  let transactionRequestRepo: jest.Mocked<TransactionRequestRepository>;
  let assetService: jest.Mocked<AssetService>;
  let fiatService: jest.Mocked<FiatService>;
  let buyService: jest.Mocked<BuyService>;
  let bankTxService: jest.Mocked<BankTxService>;
  let bankService: jest.Mocked<BankService>;
  let specialAccountService: jest.Mocked<SpecialExternalAccountService>;
  let transactionService: jest.Mocked<TransactionService>;
  let buyCryptoRepo: jest.Mocked<BuyCryptoRepository>;

  const mainnetRealuAsset = createCustomAsset({
    id: 399,
    name: 'REALU',
    blockchain: Blockchain.ETHEREUM,
    type: AssetType.TOKEN,
    decimals: 0,
  });

  const sepoliaRealuAsset = createCustomAsset({
    id: 408,
    name: 'REALU',
    blockchain: Blockchain.SEPOLIA,
    type: AssetType.TOKEN,
    decimals: 0,
  });

  const mockFiat = {
    id: 1,
    name: 'CHF',
  };

  const mockBank = {
    id: 1,
    iban: 'CH1234567890',
  };

  const mockBuy = {
    id: 1,
    bankUsage: 'DFX123',
    user: {
      id: 1,
      userData: { id: 1 },
    },
  };

  const mockBankTx = {
    id: 1,
    transaction: { id: 1 },
  };

  const mockTransactionRequest = {
    id: 7,
    amount: 100,
    sourceId: 1,
    targetId: 399,
    routeId: 1,
    status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
    type: TransactionRequestType.BUY,
  };

  beforeEach(async () => {
    // Reset environment to LOC before each test
    (global as any).__mockEnvironment = 'loc';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RealUnitDevService,
        {
          provide: TransactionRequestRepository,
          useValue: {
            find: jest.fn(),
            update: jest.fn(),
          },
        },
        {
          provide: AssetService,
          useValue: {
            getAssetByQuery: jest.fn(),
          },
        },
        {
          provide: FiatService,
          useValue: {
            getFiat: jest.fn(),
          },
        },
        {
          provide: BuyService,
          useValue: {
            getBuyByKey: jest.fn(),
          },
        },
        {
          provide: BankTxService,
          useValue: {
            create: jest.fn(),
            getBankTxByKey: jest.fn(),
          },
        },
        {
          provide: BankService,
          useValue: {
            getBankInternal: jest.fn(),
          },
        },
        {
          provide: SpecialExternalAccountService,
          useValue: {
            getMultiAccounts: jest.fn(),
          },
        },
        {
          provide: TransactionService,
          useValue: {
            updateInternal: jest.fn(),
          },
        },
        {
          provide: BuyCryptoRepository,
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<RealUnitDevService>(RealUnitDevService);
    transactionRequestRepo = module.get(TransactionRequestRepository);
    assetService = module.get(AssetService);
    fiatService = module.get(FiatService);
    buyService = module.get(BuyService);
    bankTxService = module.get(BankTxService);
    bankService = module.get(BankService);
    specialAccountService = module.get(SpecialExternalAccountService);
    transactionService = module.get(TransactionService);
    buyCryptoRepo = module.get(BuyCryptoRepository);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('simulateRealuPayments', () => {
    it('should skip execution on PRD environment', async () => {
      (global as any).__mockEnvironment = 'prd';

      await service.simulateRealuPayments();

      expect(assetService.getAssetByQuery).not.toHaveBeenCalled();
    });

    it('should execute on DEV environment', async () => {
      (global as any).__mockEnvironment = 'dev';
      assetService.getAssetByQuery.mockResolvedValueOnce(mainnetRealuAsset);
      assetService.getAssetByQuery.mockResolvedValueOnce(sepoliaRealuAsset);
      transactionRequestRepo.find.mockResolvedValue([]);

      await service.simulateRealuPayments();

      expect(assetService.getAssetByQuery).toHaveBeenCalledTimes(2);
    });

    it('should execute on LOC environment', async () => {
      (global as any).__mockEnvironment = 'loc';
      assetService.getAssetByQuery.mockResolvedValueOnce(mainnetRealuAsset);
      assetService.getAssetByQuery.mockResolvedValueOnce(sepoliaRealuAsset);
      transactionRequestRepo.find.mockResolvedValue([]);

      await service.simulateRealuPayments();

      expect(assetService.getAssetByQuery).toHaveBeenCalledTimes(2);
    });

    it('should skip if mainnet REALU asset not found', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(null);
      assetService.getAssetByQuery.mockResolvedValueOnce(sepoliaRealuAsset);

      await service.simulateRealuPayments();

      expect(transactionRequestRepo.find).not.toHaveBeenCalled();
    });

    it('should skip if sepolia REALU asset not found', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(mainnetRealuAsset);
      assetService.getAssetByQuery.mockResolvedValueOnce(null);

      await service.simulateRealuPayments();

      expect(transactionRequestRepo.find).not.toHaveBeenCalled();
    });

    it('should skip if no waiting requests', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(mainnetRealuAsset);
      assetService.getAssetByQuery.mockResolvedValueOnce(sepoliaRealuAsset);
      transactionRequestRepo.find.mockResolvedValue([]);

      await service.simulateRealuPayments();

      expect(buyService.getBuyByKey).not.toHaveBeenCalled();
    });

    it('should query for WAITING_FOR_PAYMENT requests with mainnet REALU targetId', async () => {
      assetService.getAssetByQuery.mockResolvedValueOnce(mainnetRealuAsset);
      assetService.getAssetByQuery.mockResolvedValueOnce(sepoliaRealuAsset);
      transactionRequestRepo.find.mockResolvedValue([]);

      await service.simulateRealuPayments();

      expect(transactionRequestRepo.find).toHaveBeenCalledWith({
        where: {
          status: TransactionRequestStatus.WAITING_FOR_PAYMENT,
          type: TransactionRequestType.BUY,
          targetId: 399,
        },
      });
    });
  });

  describe('simulatePaymentForRequest', () => {
    beforeEach(() => {
      assetService.getAssetByQuery.mockResolvedValueOnce(mainnetRealuAsset);
      assetService.getAssetByQuery.mockResolvedValueOnce(sepoliaRealuAsset);
    });

    it('should skip if buy route not found', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(null);

      await service.simulateRealuPayments();

      expect(bankTxService.getBankTxByKey).not.toHaveBeenCalled();
    });

    it('should skip if BankTx already exists (duplicate prevention)', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue({ id: 1 } as any);

      await service.simulateRealuPayments();

      expect(fiatService.getFiat).not.toHaveBeenCalled();
    });

    it('should skip if fiat not found', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue(null);

      await service.simulateRealuPayments();

      expect(bankService.getBankInternal).not.toHaveBeenCalled();
    });

    it('should skip if bank not found', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue(mockFiat as any);
      bankService.getBankInternal.mockResolvedValue(null);

      await service.simulateRealuPayments();

      expect(bankTxService.create).not.toHaveBeenCalled();
    });

    it('should use YAPEAL bank for CHF', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue({ id: 1, name: 'CHF' } as any);
      bankService.getBankInternal.mockResolvedValue(null);

      await service.simulateRealuPayments();

      expect(bankService.getBankInternal).toHaveBeenCalledWith('Yapeal', 'CHF');
    });

    it('should use OLKY bank for EUR', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue({ id: 2, name: 'EUR' } as any);
      bankService.getBankInternal.mockResolvedValue(null);

      await service.simulateRealuPayments();

      expect(bankService.getBankInternal).toHaveBeenCalledWith('Olkypay', 'EUR');
    });

    it('should create BankTx, BuyCrypto, update Transaction, and complete TransactionRequest', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue(mockFiat as any);
      bankService.getBankInternal.mockResolvedValue(mockBank as any);
      specialAccountService.getMultiAccounts.mockResolvedValue([]);
      bankTxService.create.mockResolvedValue(mockBankTx as any);
      buyCryptoRepo.create.mockReturnValue({ id: 1 } as any);
      buyCryptoRepo.save.mockResolvedValue({ id: 1 } as any);

      await service.simulateRealuPayments();

      // 1. Should create BankTx
      expect(bankTxService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 100,
          currency: 'CHF',
          remittanceInfo: 'DFX123',
          txInfo: 'DEV simulation for TransactionRequest 7',
        }),
        [],
      );

      // 2. Should create BuyCrypto with Sepolia asset
      expect(buyCryptoRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          inputAmount: 100,
          inputAsset: 'CHF',
          outputAsset: sepoliaRealuAsset,
          amlCheck: 'Pass',
        }),
      );
      expect(buyCryptoRepo.save).toHaveBeenCalled();

      // 3. Should update Transaction
      expect(transactionService.updateInternal).toHaveBeenCalledWith(
        { id: 1 },
        expect.objectContaining({
          type: 'BuyCrypto',
        }),
      );

      // 4. Should complete TransactionRequest
      expect(transactionRequestRepo.update).toHaveBeenCalledWith(7, {
        isComplete: true,
        status: TransactionRequestStatus.COMPLETED,
      });
    });

    it('should process multiple requests', async () => {
      const request1 = { ...mockTransactionRequest, id: 1 };
      const request2 = { ...mockTransactionRequest, id: 2 };
      const request3 = { ...mockTransactionRequest, id: 3 };

      transactionRequestRepo.find.mockResolvedValue([request1, request2, request3] as any);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue(mockFiat as any);
      bankService.getBankInternal.mockResolvedValue(mockBank as any);
      specialAccountService.getMultiAccounts.mockResolvedValue([]);
      bankTxService.create.mockResolvedValue(mockBankTx as any);
      buyCryptoRepo.create.mockReturnValue({ id: 1 } as any);
      buyCryptoRepo.save.mockResolvedValue({ id: 1 } as any);

      await service.simulateRealuPayments();

      expect(bankTxService.create).toHaveBeenCalledTimes(3);
      expect(buyCryptoRepo.save).toHaveBeenCalledTimes(3);
      expect(transactionRequestRepo.update).toHaveBeenCalledTimes(3);
    });

    it('should continue processing other requests if one fails', async () => {
      const request1 = { ...mockTransactionRequest, id: 1 };
      const request2 = { ...mockTransactionRequest, id: 2 };

      transactionRequestRepo.find.mockResolvedValue([request1, request2] as any);
      buyService.getBuyByKey.mockRejectedValueOnce(new Error('Failed')).mockResolvedValueOnce(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue(mockFiat as any);
      bankService.getBankInternal.mockResolvedValue(mockBank as any);
      specialAccountService.getMultiAccounts.mockResolvedValue([]);
      bankTxService.create.mockResolvedValue(mockBankTx as any);
      buyCryptoRepo.create.mockReturnValue({ id: 1 } as any);
      buyCryptoRepo.save.mockResolvedValue({ id: 1 } as any);

      await service.simulateRealuPayments();

      // Second request should still be processed
      expect(transactionRequestRepo.update).toHaveBeenCalledTimes(1);
      expect(transactionRequestRepo.update).toHaveBeenCalledWith(2, expect.anything());
    });

    it('should use unique txInfo per TransactionRequest for duplicate detection', async () => {
      transactionRequestRepo.find.mockResolvedValue([mockTransactionRequest as any]);
      buyService.getBuyByKey.mockResolvedValue(mockBuy as any);
      bankTxService.getBankTxByKey.mockResolvedValue(null);
      fiatService.getFiat.mockResolvedValue(mockFiat as any);
      bankService.getBankInternal.mockResolvedValue(mockBank as any);
      specialAccountService.getMultiAccounts.mockResolvedValue([]);
      bankTxService.create.mockResolvedValue(mockBankTx as any);
      buyCryptoRepo.create.mockReturnValue({ id: 1 } as any);
      buyCryptoRepo.save.mockResolvedValue({ id: 1 } as any);

      await service.simulateRealuPayments();

      // Should check for existing BankTx using txInfo field with TransactionRequest ID
      expect(bankTxService.getBankTxByKey).toHaveBeenCalledWith('txInfo', 'DEV simulation for TransactionRequest 7');
    });
  });
});
