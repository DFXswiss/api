import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CryptoRouteService } from 'src/subdomains/core/buy-crypto/routes/crypto-route/crypto-route.service';
import { createCustomHistory } from 'src/subdomains/core/history/dto/__mocks__/history.dto.mock';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/bank-tx.service';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { BuyRepository } from '../../../routes/buy/buy.repository';
import { BuyService } from '../../../routes/buy/buy.service';
import { createCustomBuyHistory } from '../../../routes/buy/dto/__mocks__/buy-history.dto.mock';
import { createCustomBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCrypto } from '../../entities/buy-crypto.entity';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoWebhookService } from '../buy-crypto-webhook.service';
import { BuyCryptoService } from '../buy-crypto.service';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
  BUY_HISTORY_SMALL,
  CRYPTO_HISTORY_EMPTY,
  CRYPTO_HISTORY,
}

describe('BuyCryptoService', () => {
  let service: BuyCryptoService;

  let buyCryptoRepo: BuyCryptoRepository;
  let bankTxService: BankTxService;
  let buyRepo: BuyRepository;
  let buyService: BuyService;
  let cryptoRouteService: CryptoRouteService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let assetService: AssetService;
  let bankDataService: BankDataService;

  beforeEach(async () => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    bankTxService = createMock<BankTxService>();
    buyRepo = createMock<BuyRepository>();
    buyService = createMock<BuyService>();
    cryptoRouteService = createMock<CryptoRouteService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    assetService = createMock<AssetService>();
    bankDataService = createMock<BankDataService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyCryptoService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BankTxService, useValue: bankTxService },
        { provide: BuyRepository, useValue: buyRepo },
        { provide: BuyService, useValue: buyService },
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: AssetService, useValue: assetService },
        { provide: BankDataService, useValue: bankDataService },
      ],
    }).compile();

    service = module.get<BuyCryptoService>(BuyCryptoService);
  });

  const txOne = {
    inputAmount: 1,
    inputAsset: 'EUR',
    outputAmount: 0.00005,
    outputAsset: 'BTC',
  };

  const txTwo = {
    inputAmount: 10,
    inputAsset: 'EUR',
    outputAmount: 0.0005,
    outputAsset: 'BTC',
  };

  const txSmallAmount = {
    inputAmount: 1,
    inputAsset: 'EUR',
    outputAmount: 3e-8,
    outputAsset: 'GOOGL',
  };

  const txCrypto = {
    inputAmount: 1,
    inputAsset: 'BTC',
    outputAmount: 0.988,
    outputAsset: 'BTC',
    txId: 'TX_ID_01',
  };

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyCrypto[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [
            createCustomBuyCrypto({ outputDate: date, ...txOne, outputAsset: createCustomAsset({ dexName: 'BTC' }) }),
            createCustomBuyCrypto({ outputDate: date, ...txTwo, outputAsset: createCustomAsset({ dexName: 'BTC' }) }),
          ];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [
            createCustomBuyCrypto({
              outputDate: date,
              ...txSmallAmount,
              outputAsset: createCustomAsset({ dexName: 'GOOGL' }),
            }),
          ];
          break;
        case MockBuyData.CRYPTO_HISTORY:
          wantedData = [
            createCustomBuyCrypto({
              outputDate: date,
              cryptoInput: createCustomCryptoInput({}),
              ...txCrypto,
              outputAsset: createCustomAsset({ dexName: 'BTC' }),
            }),
          ];
          break;
      }

      jest.spyOn(buyCryptoRepo, 'find').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array, if buy route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getBuyHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if buy route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getBuyHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyHistory({
        date: date,
        ...txOne,
      }),
      createCustomBuyHistory({
        date: date,
        ...txTwo,
      }),
    ]);
  });

  it('should return a history, if buy route has transactions and show small amount correctly', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY_SMALL, date);

    await expect(service.getBuyHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyHistory({
        date: date,
        ...txSmallAmount,
      }),
    ]);
  });

  it('should return an empty history, if crypto route has no transactions', async () => {
    setup(MockBuyData.CRYPTO_HISTORY_EMPTY);

    await expect(service.getCryptoHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if crypto route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.CRYPTO_HISTORY, date);

    await expect(service.getCryptoHistory(1, 1)).resolves.toStrictEqual([
      createCustomHistory({
        date: date,
        ...txCrypto,
      }),
    ]);
  });
});
