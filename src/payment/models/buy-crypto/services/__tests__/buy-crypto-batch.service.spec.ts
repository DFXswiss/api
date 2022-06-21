import { mock } from 'jest-mock-extended';
import { Price } from 'src/payment/models/exchange/dto/price.dto';
import { ExchangeUtilityService } from 'src/payment/models/exchange/exchange-utility.service';
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
  let buyCryptoBatchRepoFind: jest.SpyInstance;
  let buyCryptoBatchRepoSave: jest.SpyInstance;
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
    it('returns early when there is no input transactions', () => {
      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => []);

      const result = service.batchTransactionsByAssets();

      expect(result).toBeUndefined();
      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('defines asset pair', () => {
      const transactions = [createCustomBuyCrypto({ outputReferenceAsset: null })];
      const defineAssetExchangePairSpy = jest.spyOn(transactions[0], 'defineAssetExchangePair');

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAsset).toBe(null);

      service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(1);
      expect(defineAssetExchangePairSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAsset).toBe('BTC');
    });

    it('defines output reference amounts', () => {
      const transactions = [createCustomBuyCrypto({ outputReferenceAmount: null, amountInEur: 100 })];
      const calculateOutputReferenceAmountSpy = jest.spyOn(transactions[0], 'calculateOutputReferenceAmount');

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      expect(transactions[0].outputReferenceAmount).toBe(null);

      service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(1);
      expect(exchangeUtilityServiceGetMatchingPrice).toBeCalledTimes(1);
      expect(calculateOutputReferenceAmountSpy).toBeCalledTimes(1);
      expect(transactions[0].outputReferenceAmount).toBe(10);
    });

    it('moves on normally if there is no blocked assets', () => {
      service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(1);
      expect(buyCryptoOutServiceGetAssetsOnOutNode).toBeCalledTimes(1);
    });

    it('blocks creating a batch if there is a matching blocked asset', () => {
      buyCryptoOutServiceGetAssetsOnOutNode = jest
        .spyOn(buyCryptoOutService, 'getAssetsOnOutNode')
        .mockImplementation(async () => [{ asset: 'dTSLA', amount: 10 }]);

      service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('blocks creating a batch if there already existing batch for an asset', () => {
      const transactions = [createCustomBuyCrypto({ outputAsset: 'dDOGE' })];

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      buyCryptoBatchRepoFind = jest
        .spyOn(buyCryptoBatchRepo, 'find')
        .mockImplementation(async () => [createCustomBuyCryptoBatch({ outputAsset: 'sDOGE' })]);

      service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(0);
    });

    it('creates separate batches for separate asset pairs', () => {
      const transactions = [
        createCustomBuyCrypto({ outputReferenceAsset: 'BTC', outputAsset: 'dDOGE' }),
        createCustomBuyCrypto({ outputReferenceAsset: 'BTC', outputAsset: 'dTSLA' }),
        createCustomBuyCrypto({ outputReferenceAsset: 'USDT', outputAsset: 'USDT' }),
      ];

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      service.batchTransactionsByAssets();

      expect(buyCryptoBatchRepoSave).toBeCalledTimes(3);
    });

    it('groups transactions with same asset pair into one batch', () => {
      const transactions = [
        createCustomBuyCrypto({ outputReferenceAsset: 'BTC', outputAsset: 'dDOGE' }),
        createCustomBuyCrypto({ outputReferenceAsset: 'BTC', outputAsset: 'dDOGE' }),
        createCustomBuyCrypto({ outputReferenceAsset: 'USDT', outputAsset: 'USDT' }),
      ];

      buyCryptoRepoFind = jest.spyOn(buyCryptoRepo, 'find').mockImplementation(async () => transactions);

      service.batchTransactionsByAssets();

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

    buyCryptoBatchRepoFind = jest.spyOn(buyCryptoBatchRepo, 'find').mockImplementation(async () => []);

    buyCryptoBatchRepoSave = jest
      .spyOn(buyCryptoBatchRepo, 'save')
      .mockImplementation(async () => createDefaultBuyCryptoBatch());

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
    buyCryptoBatchRepoFind.mockClear();
    buyCryptoBatchRepoSave.mockClear();
    buyCryptoOutServiceGetAssetsOnOutNode.mockClear();
    exchangeUtilityServiceGetMatchingPrice.mockClear();
  }
});
