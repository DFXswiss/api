import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { FeeService } from 'src/subdomains/supporting/payment/services/fee.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { PriceProviderService } from 'src/subdomains/supporting/pricing/services/price-provider.service';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoPreparationService } from '../buy-crypto-preparation.service';
import { BuyCryptoWebhookService } from '../buy-crypto-webhook.service';
import { BuyCryptoService } from '../buy-crypto.service';

describe('BuyCryptoPreparationService', () => {
  let service: BuyCryptoPreparationService;

  /*** Dependencies ***/

  let buyCryptoRepo: BuyCryptoRepository;
  let transactionHelper: TransactionHelper;
  let priceProviderService: PriceProviderService;
  let assetService: AssetService;
  let fiatService: FiatService;
  let bankDataService: BankDataService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let feeService: FeeService;
  let buyCryptoService: BuyCryptoService;

  /*** Spies ***/

  beforeEach(async () => {
    await setupMocks();
    setupSpies();
  });

  describe('#prepareTransactions(...)', () => {
    it('returns early when there is no input transactions', async () => {
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = await service.prepareTransactions();

      expect(result).toBeUndefined();
    });

    it('defines asset pair', async () => {
      const transactions = [createCustomBuyCrypto({ outputReferenceAsset: null })];
      const defineAssetExchangePairSpy = jest.spyOn(transactions[0], 'defineAssetExchangePair');
      jest
        .spyOn(assetService, 'getAssetByQuery')
        .mockImplementation(async ({ dexName }) => createCustomAsset({ dexName }));

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAsset).toBe(null);

      await service.prepareTransactions();

      expect(defineAssetExchangePairSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAsset.dexName).toBe('BTC');
    });
  });

  // --- HELPER FUNCTIONS --- //

  async function setupMocks() {
    buyCryptoRepo = mock<BuyCryptoRepository>();
    transactionHelper = mock<TransactionHelper>();
    priceProviderService = mock<PriceProviderService>();
    fiatService = mock<FiatService>();
    assetService = mock<AssetService>();
    bankDataService = mock<BankDataService>();
    buyCryptoWebhookService = mock<BuyCryptoWebhookService>();
    feeService = mock<FeeService>();
    buyCryptoService = mock<BuyCryptoService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyCryptoPreparationService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: PriceProviderService, useValue: priceProviderService },
        { provide: FiatService, useValue: fiatService },
        { provide: AssetService, useValue: assetService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: FeeService, useValue: feeService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BuyCryptoPreparationService>(BuyCryptoPreparationService);
  }

  function setupSpies() {
    jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => [createDefaultBuyCrypto()]);

    jest.spyOn(assetService, 'getAssetByQuery').mockImplementation(async () => createDefaultAsset());
  }
});
