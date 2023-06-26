import { Test, TestingModule } from '@nestjs/testing';
import { mock } from 'jest-mock-extended';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { LiquidityManagementService } from 'src/subdomains/core/liquidity-management/services/liquidity-management.service';
import { CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { Price } from 'src/subdomains/supporting/pricing/domain/entities/price';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import {
  createCustomBuyCryptoBatch,
  createDefaultBuyCryptoBatch,
} from '../../entities/__mocks__/buy-crypto-batch.entity.mock';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoBatchRepository } from '../../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from '../buy-crypto-batch.service';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoPricingService } from '../buy-crypto-pricing.service';

describe('BuyCryptoBatchService', () => {
  let service: BuyCryptoBatchService;

  /*** Dependencies ***/

  let buyCryptoRepo: BuyCryptoRepository;
  let buyCryptoBatchRepo: BuyCryptoBatchRepository;
  let pricingService: PricingService;
  let buyCryptoPricingService: BuyCryptoPricingService;
  let assetService: AssetService;
  let dexService: DexService;
  let payoutService: PayoutService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let liquidityManagementService: LiquidityManagementService;

  /*** Spies ***/

  let buyCryptoBatchRepoSave: jest.SpyInstance;
  let exchangeUtilityServiceGetMatchingPrice: jest.SpyInstance;
  let dexServiceCheckLiquidity: jest.SpyInstance;

  beforeEach(async () => {
    await setupMocks();
    setupSpies();
  });

  describe('#prepareTransactions(...)', () => {
    it('returns early when there is no input transactions', async () => {
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = await service.prepareTransactions();

      expect(result).toBeUndefined();
      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
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

  describe('#batchAndOptimizeTransactions(...)', () => {
    it('returns early when there is no input transactions', async () => {
      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = await service.batchAndOptimizeTransactions();

      expect(result).toBeUndefined();
      expect(dexServiceCheckLiquidity).toBeCalledTimes(0);
    });

    it('defines output reference amounts', async () => {
      const transactions = [
        createCustomBuyCrypto({
          outputAsset: createDefaultAsset(),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
          outputReferenceAmount: null,
          inputReferenceAmountMinusFee: 10000,
        }),
      ];
      const calculateOutputReferenceAmountSpy = jest.spyOn(transactions[0], 'calculateOutputReferenceAmount');

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAmount).toBe(null);

      await service.batchAndOptimizeTransactions();

      expect(exchangeUtilityServiceGetMatchingPrice).toBeCalledTimes(1);
      expect(calculateOutputReferenceAmountSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAmount).toBe(1000);
      expect(dexServiceCheckLiquidity).toBeCalledTimes(1);
    });

    it('moves on normally if there is no blocked assets', async () => {
      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(1);
    });

    it('blocks creating a batch if there already existing batch for an asset', async () => {
      const transactions = [createCustomBuyCrypto({ outputAsset: createCustomAsset({ dexName: 'dDOGE' }) })];

      jest
        .spyOn(buyCryptoBatchRepo, 'findOneBy')
        .mockImplementation(async () =>
          createCustomBuyCryptoBatch({ outputAsset: createCustomAsset({ dexName: 'dDOGE' }) }),
        );

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(0);
    });

    it('creates separate batches for separate asset pairs', async () => {
      const transactions = [
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dGOOGL' }) }),
          outputAsset: createCustomAsset({ dexName: 'dGOOGL' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dTSLA' }) }),
          outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDT' }) }),
          outputAsset: createCustomAsset({ dexName: 'USDT' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
        }),
      ];

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 1, dexName: 'dGOOGL' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 2, dexName: 'dTSLA' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
            outputAsset: createCustomAsset({ id: 3, dexName: 'USDT' }),
          }),
        );

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(3);
    });

    it('groups transactions with same asset pair into one batch', async () => {
      const transactions = [
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dTSLA' }) }),
          outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'dTSLA' }) }),
          outputAsset: createCustomAsset({ dexName: 'dTSLA' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ dexName: 'USDT' }) }),
          outputAsset: createCustomAsset({ dexName: 'USDT' }),
          outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
        }),
      ];

      jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 1, dexName: 'dTSLA' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            id: undefined,
            outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
            outputAsset: createCustomAsset({ id: 2, dexName: 'USDT' }),
          }),
        );

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(2);
    });
  });

  // --- HELPER FUNCTIONS --- //

  async function setupMocks() {
    buyCryptoRepo = mock<BuyCryptoRepository>();
    buyCryptoBatchRepo = mock<BuyCryptoBatchRepository>();
    pricingService = mock<PricingService>();
    buyCryptoPricingService = mock<BuyCryptoPricingService>();
    assetService = mock<AssetService>();
    dexService = mock<DexService>();
    payoutService = mock<PayoutService>();
    buyCryptoNotificationService = mock<BuyCryptoNotificationService>();
    liquidityManagementService = mock<LiquidityManagementService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BuyCryptoBatchService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BuyCryptoBatchRepository, useValue: buyCryptoBatchRepo },
        { provide: PricingService, useValue: pricingService },
        { provide: BuyCryptoPricingService, useValue: buyCryptoPricingService },
        { provide: AssetService, useValue: assetService },
        { provide: DexService, useValue: dexService },
        { provide: PayoutService, useValue: payoutService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: LiquidityManagementService, useValue: liquidityManagementService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<BuyCryptoBatchService>(BuyCryptoBatchService);
  }

  function setupSpies() {
    jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => [createDefaultBuyCrypto()]);

    jest.spyOn(buyCryptoBatchRepo, 'findOneBy').mockImplementation(async () => null);

    buyCryptoBatchRepoSave = jest
      .spyOn(buyCryptoBatchRepo, 'save')
      .mockImplementation(async () => createDefaultBuyCryptoBatch());

    jest.spyOn(buyCryptoBatchRepo, 'create').mockImplementation(() => createCustomBuyCryptoBatch({ id: undefined }));

    exchangeUtilityServiceGetMatchingPrice = jest
      .spyOn(pricingService, 'getPrice')
      .mockImplementationOnce(async () => {
        const price = new Price();
        (price.price = 10), (price.source = 'EUR'), (price.target = 'BTC');
        return { price, path: [] };
      })
      .mockImplementationOnce(async () => {
        const price = new Price();
        (price.price = 10), (price.source = 'EUR'), (price.target = 'USDT');
        return { price, path: [] };
      });

    jest.spyOn(buyCryptoPricingService, 'getFeeAmountInRefAsset').mockImplementation(async () => 0.001);

    dexServiceCheckLiquidity = jest.spyOn(dexService, 'checkLiquidity').mockImplementation(
      async () =>
        ({
          purchaseFee: { amount: 0, asset: createDefaultAsset() },
          reference: { availableAmount: 10000, maxPurchasableAmount: 1000000 },
        } as unknown as CheckLiquidityResult),
    );

    jest.spyOn(payoutService, 'estimateFee').mockImplementation(async () => ({
      asset: createCustomAsset({}),
      amount: 0.0000001,
    }));

    jest.spyOn(assetService, 'getAssetByQuery').mockImplementation(async () => createDefaultAsset());
  }
});
