import { mock } from 'jest-mock-extended';
import { createCustomBuy } from 'src/subdomains/core/buy-crypto/routes/buy/__mocks__/buy.entity.mock';
import { CheckLiquidityResult } from 'src/subdomains/supporting/dex/interfaces';
import { DexService } from 'src/subdomains/supporting/dex/services/dex.service';
import { Price } from 'src/integration/exchange/dto/price.dto';
import { PayoutService } from 'src/subdomains/supporting/payout/services/payout.service';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { createCustomAsset, createDefaultAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
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
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';

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

  /*** Spies ***/

  let buyCryptoRepoFind: jest.SpyInstance;
  let buyCryptoBatchRepoFindOne: jest.SpyInstance;
  let buyCryptoBatchRepoSave: jest.SpyInstance;
  let buyCryptoBatchRepoCreate: jest.SpyInstance;
  let exchangeUtilityServiceGetMatchingPrice: jest.SpyInstance;
  let buyCryptoPricingServiceConvert: jest.SpyInstance;
  let dexServiceCheckLiquidity: jest.SpyInstance;
  let payoutServiceEstimateFee: jest.SpyInstance;
  let assetServiceQueryAsset: jest.SpyInstance;

  beforeEach(() => {
    setupMocks();
    setupSpies();
  });

  afterEach(() => {
    clearSpies();
  });

  describe('#prepareTransactions(...)', () => {
    it('returns early when there is no input transactions', async () => {
      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = await service.prepareTransactions();

      expect(result).toBeUndefined();
      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('defines asset pair', async () => {
      const transactions = [createCustomBuyCrypto({ outputReferenceAsset: null })];
      const defineAssetExchangePairSpy = jest.spyOn(transactions[0], 'defineAssetExchangePair');
      assetServiceQueryAsset = jest
        .spyOn(assetService, 'getAssetByQuery')
        .mockImplementation(async ({ dexName }) => createCustomAsset({ dexName }));

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAsset).toBe(null);

      await service.prepareTransactions();

      expect(defineAssetExchangePairSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAsset.dexName).toBe('BTC');
    });
  });

  describe('#batchAndOptimizeTransactions(...)', () => {
    it('returns early when there is no input transactions', async () => {
      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

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
          inputReferenceAmountMinusFee: 100,
        }),
      ];
      const calculateOutputReferenceAmountSpy = jest.spyOn(transactions[0], 'calculateOutputReferenceAmount');

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAmount).toBe(null);

      await service.batchAndOptimizeTransactions();

      expect(exchangeUtilityServiceGetMatchingPrice).toBeCalledTimes(1);
      expect(calculateOutputReferenceAmountSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAmount).toBe(10);
      expect(dexServiceCheckLiquidity).toBeCalledTimes(1);
    });

    it('moves on normally if there is no blocked assets', async () => {
      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(1);
    });

    it('blocks creating a batch if there already existing batch for an asset', async () => {
      const transactions = [createCustomBuyCrypto({ outputAsset: createCustomAsset({ dexName: 'dDOGE' }) })];

      buyCryptoBatchRepoFindOne = jest
        .spyOn(buyCryptoBatchRepo, 'findOne')
        .mockImplementation(async () =>
          createCustomBuyCryptoBatch({ outputAsset: createCustomAsset({ dexName: 'dDOGE' }) }),
        );

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

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

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      buyCryptoBatchRepoCreate = jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 1, dexName: 'dGOOGL' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 2, dexName: 'dTSLA' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
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

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      buyCryptoBatchRepoCreate = jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            outputReferenceAsset: createCustomAsset({ dexName: 'BTC' }),
            outputAsset: createCustomAsset({ id: 1, dexName: 'dTSLA' }),
          }),
        )
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({
            outputReferenceAsset: createCustomAsset({ dexName: 'USDT' }),
            outputAsset: createCustomAsset({ id: 2, dexName: 'USDT' }),
          }),
        );

      await service.batchAndOptimizeTransactions();

      expect(dexServiceCheckLiquidity).toBeCalledTimes(2);
    });
  });

  // --- HELPER FUNCTIONS --- //

  function setupMocks() {
    buyCryptoRepo = mock<BuyCryptoRepository>();
    buyCryptoBatchRepo = mock<BuyCryptoBatchRepository>();
    pricingService = mock<PricingService>();
    buyCryptoPricingService = mock<BuyCryptoPricingService>();
    assetService = mock<AssetService>();
    dexService = mock<DexService>();
    payoutService = mock<PayoutService>();
    buyCryptoNotificationService = mock<BuyCryptoNotificationService>();

    service = new BuyCryptoBatchService(
      buyCryptoRepo,
      buyCryptoBatchRepo,
      pricingService,
      buyCryptoPricingService,
      assetService,
      dexService,
      payoutService,
      buyCryptoNotificationService,
    );
  }

  function setupSpies() {
    buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => [createDefaultBuyCrypto()]);

    buyCryptoBatchRepoFindOne = jest.spyOn(buyCryptoBatchRepo, 'findOne').mockImplementation(async () => null);

    buyCryptoBatchRepoSave = jest
      .spyOn(buyCryptoBatchRepo, 'save')
      .mockImplementation(async () => createDefaultBuyCryptoBatch());

    buyCryptoBatchRepoCreate = jest
      .spyOn(buyCryptoBatchRepo, 'create')
      .mockImplementation(() => createDefaultBuyCryptoBatch());

    exchangeUtilityServiceGetMatchingPrice = jest.spyOn(pricingService, 'getPrice').mockImplementation(async () => {
      const price = new Price();
      (price.price = 10), (price.source = 'EUR'), (price.target = 'BTC');
      return { price, path: [] };
    });

    buyCryptoPricingServiceConvert = jest
      .spyOn(buyCryptoPricingService, 'getFeeAmountInBatchAsset')
      .mockImplementation(async () => 1);

    dexServiceCheckLiquidity = jest.spyOn(dexService, 'checkLiquidity').mockImplementation(
      async () =>
        ({
          reference: { availableAmount: 10000, maxPurchasableAmount: 1000000 },
        } as unknown as CheckLiquidityResult),
    );

    payoutServiceEstimateFee = jest.spyOn(payoutService, 'estimateFee').mockImplementation(async () => ({
      asset: createCustomAsset({}),
      amount: 0.0000001,
    }));

    assetServiceQueryAsset = jest
      .spyOn(assetService, 'getAssetByQuery')
      .mockImplementation(async () => createDefaultAsset());
  }

  function clearSpies() {
    buyCryptoRepoFind.mockClear();
    buyCryptoBatchRepoFindOne.mockClear();
    buyCryptoBatchRepoSave.mockClear();
    buyCryptoBatchRepoCreate.mockClear();
    exchangeUtilityServiceGetMatchingPrice.mockClear();
    buyCryptoPricingServiceConvert.mockClear();
    dexServiceCheckLiquidity.mockClear();
    payoutServiceEstimateFee.mockClear();
    assetServiceQueryAsset.mockClear();
  }
});
