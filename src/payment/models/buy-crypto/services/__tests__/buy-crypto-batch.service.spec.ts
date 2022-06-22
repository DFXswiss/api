import { mock } from 'jest-mock-extended';
import { createCustomBuy } from 'src/payment/models/buy/__tests__/mock/buy.entity.mock';
import { Price } from 'src/payment/models/exchange/dto/price.dto';
import { ExchangeUtilityService } from 'src/payment/models/exchange/exchange-utility.service';
import { createCustomAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import {
  createCustomBuyCryptoBatch,
  createDefaultBuyCryptoBatch,
} from '../../entities/__tests__/mock/buy-crypto-batch.entity.mock';
import { createCustomBuyCrypto, createDefaultBuyCrypto } from '../../entities/__tests__/mock/buy-crypto.entity.mock';
import { BuyCryptoBatchRepository } from '../../repositories/buy-crypto-batch.repository';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from '../buy-crypto-batch.service';
import { BuyCryptoOutService } from '../buy-crypto-out.service';

describe('BuyCryptoBatchService', () => {
  let service: BuyCryptoBatchService;

  /*** Dependencies ***/

  let buyCryptoRepo: BuyCryptoRepository;
  let buyCryptoBatchRepo: BuyCryptoBatchRepository;
  let buyCryptoOutService: BuyCryptoOutService;
  let exchangeUtilityService: ExchangeUtilityService;

  /*** Spies ***/

  let buyCryptoRepoFind: jest.SpyInstance;
  let buyCryptoBatchRepoFindOne: jest.SpyInstance;
  let buyCryptoBatchRepoSave: jest.SpyInstance;
  let buyCryptoBatchRepoCreate: jest.SpyInstance;
  let buyCryptoOutServiceGetAssetsOnOutNode: jest.SpyInstance;
  let exchangeUtilityServiceGetMatchingPrice: jest.SpyInstance;

  beforeEach(() => {
    setupMocks();
    setupSpies();
  });

  afterEach(() => {
    clearSpies();
  });

  describe('#batchTransactionsByAssets(...)', () => {
    it('returns early when there is no input transactions', async () => {
      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = await service.batchTransactionsByAssets();

      expect(result).toBeUndefined();
      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('defines asset pair', async () => {
      const transactions = [createCustomBuyCrypto({ outputReferenceAsset: null })];
      const defineAssetExchangePairSpy = jest.spyOn(transactions[0], 'defineAssetExchangePair');

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAsset).toBe(null);

      await service.batchTransactionsByAssets();

      expect(defineAssetExchangePairSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAsset).toBe('BTC');
      expect(buyCryptoBatchRepoSave).toBeCalledTimes(1);
    });

    it('defines output reference amounts', async () => {
      const transactions = [createCustomBuyCrypto({ outputReferenceAmount: null, amountInEur: 100 })];
      const calculateOutputReferenceAmountSpy = jest.spyOn(transactions[0], 'calculateOutputReferenceAmount');

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAmount).toBe(null);

      await service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(1);
      expect(exchangeUtilityServiceGetMatchingPrice).toBeCalledTimes(1);
      expect(calculateOutputReferenceAmountSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAmount).toBe(10);
    });

    it('moves on normally if there is no blocked assets', async () => {
      await service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(1);
      expect(buyCryptoOutServiceGetAssetsOnOutNode).toBeCalledTimes(1);
    });

    it('blocks creating a batch if there is a matching blocked asset', async () => {
      buyCryptoOutServiceGetAssetsOnOutNode = jest
        .spyOn(buyCryptoOutService, 'getAssetsOnOutNode')
        .mockImplementation(async () => [{ asset: 'dTSLA', amount: 10 }]);

      await service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('blocks creating a batch if there already existing batch for an asset', async () => {
      const transactions = [createCustomBuyCrypto({ outputAsset: 'dDOGE' })];

      buyCryptoBatchRepoFindOne = jest
        .spyOn(buyCryptoBatchRepo, 'findOne')
        .mockImplementation(async () => createCustomBuyCryptoBatch({ outputAsset: 'dDOGE' }));

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      await service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('creates separate batches for separate asset pairs', async () => {
      const transactions = [
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ name: 'dDOGE' }) }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ name: 'dTSLA' }) }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ name: 'USDT' }) }),
        }),
      ];

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      buyCryptoBatchRepoCreate = jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() => createCustomBuyCryptoBatch({ outputReferenceAsset: 'BTC', outputAsset: 'dDOGE' }))
        .mockImplementationOnce(() => createCustomBuyCryptoBatch({ outputReferenceAsset: 'BTC', outputAsset: 'dTSLA' }))
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({ outputReferenceAsset: 'USDT', outputAsset: 'USDT' }),
        );

      await service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(3);
    });

    it('groups transactions with same asset pair into one batch', async () => {
      const transactions = [
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ name: 'dTSLA' }) }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ name: 'dTSLA' }) }),
        }),
        createCustomBuyCrypto({
          buy: createCustomBuy({ asset: createCustomAsset({ name: 'USDT' }) }),
        }),
      ];

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      buyCryptoBatchRepoCreate = jest
        .spyOn(buyCryptoBatchRepo, 'create')
        .mockImplementationOnce(() => createCustomBuyCryptoBatch({ outputReferenceAsset: 'BTC', outputAsset: 'dDOGE' }))
        .mockImplementationOnce(() =>
          createCustomBuyCryptoBatch({ outputReferenceAsset: 'USDT', outputAsset: 'USDT' }),
        );

      await service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(2);
    });
  });

  // --- HELPER FUNCTIONS --- //

  function setupMocks() {
    buyCryptoRepo = mock<BuyCryptoRepository>();
    buyCryptoBatchRepo = mock<BuyCryptoBatchRepository>();
    buyCryptoOutService = mock<BuyCryptoOutService>();
    exchangeUtilityService = mock<ExchangeUtilityService>();

    service = new BuyCryptoBatchService(buyCryptoRepo, buyCryptoBatchRepo, buyCryptoOutService, exchangeUtilityService);
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

    buyCryptoOutServiceGetAssetsOnOutNode = jest
      .spyOn(buyCryptoOutService, 'getAssetsOnOutNode')
      .mockImplementation(async () => []);

    exchangeUtilityServiceGetMatchingPrice = jest
      .spyOn(exchangeUtilityService, 'getMatchingPrice')
      .mockImplementation(async () => {
        const price = new Price();
        (price.price = 10), (price.currencyPair = 'EUR/BTC');
        return price;
      });
  }

  function clearSpies() {
    buyCryptoRepoFind.mockClear();
    buyCryptoBatchRepoFindOne.mockClear();
    buyCryptoBatchRepoSave.mockClear();
    buyCryptoBatchRepoCreate.mockClear();
    buyCryptoOutServiceGetAssetsOnOutNode.mockClear();
    exchangeUtilityServiceGetMatchingPrice.mockClear();
  }
});
