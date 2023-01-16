import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CryptoInputType } from 'src/mix/models/crypto-input/crypto-input.entity';
import { createCustomCryptoInput } from 'src/mix/models/crypto-input/__mocks__/crypto-input.entity.mock';
import { CryptoRouteRepository } from 'src/mix/models/crypto-route/crypto-route.repository';
import { CryptoRouteService } from 'src/mix/models/crypto-route/crypto-route.service';
import { createCustomCryptoHistory } from 'src/mix/models/crypto-route/dto/__mocks__/crypto-history.dto.mock';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/buy-fiat.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankTxRepository } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.repository';
import { BankTxService } from 'src/subdomains/supporting/bank/bank-tx/bank-tx.service';
import { BuyRepository } from '../../../route/buy.repository';
import { BuyService } from '../../../route/buy.service';
import { createCustomBuyHistory } from '../../../route/dto/__mocks__/buy-history.dto.mock';
import { BuyCrypto } from '../../entities/buy-crypto.entity';
import { createCustomBuyCrypto } from '../../entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoRepository } from '../../repositories/buy-crypto.repository';
import { BuyCryptoBatchService } from '../buy-crypto-batch.service';
import { BuyCryptoDexService } from '../buy-crypto-dex.service';
import { BuyCryptoNotificationService } from '../buy-crypto-notification.service';
import { BuyCryptoOutService } from '../buy-crypto-out.service';
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
  let bankTxRepo: BankTxRepository;
  let bankTxService: BankTxService;
  let cryptoRouteRepo: CryptoRouteRepository;
  let buyRepo: BuyRepository;
  let settingService: SettingService;
  let buyService: BuyService;
  let cryptoRouteService: CryptoRouteService;
  let buyCryptoBatchService: BuyCryptoBatchService;
  let buyCryptoOutService: BuyCryptoOutService;
  let buyCryptoDexService: BuyCryptoDexService;
  let buyCryptoNotificationService: BuyCryptoNotificationService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;

  beforeEach(async () => {
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    bankTxRepo = createMock<BankTxRepository>();
    bankTxService = createMock<BankTxService>();
    cryptoRouteRepo = createMock<CryptoRouteRepository>();
    buyRepo = createMock<BuyRepository>();
    settingService = createMock<SettingService>();
    buyService = createMock<BuyService>();
    cryptoRouteService = createMock<CryptoRouteService>();
    buyCryptoBatchService = createMock<BuyCryptoBatchService>();
    buyCryptoOutService = createMock<BuyCryptoOutService>();
    buyCryptoDexService = createMock<BuyCryptoDexService>();
    buyCryptoNotificationService = createMock<BuyCryptoNotificationService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyCryptoService,
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: BankTxRepository, useValue: bankTxRepo },
        { provide: BankTxService, useValue: bankTxService },
        { provide: CryptoRouteRepository, useValue: cryptoRouteRepo },
        { provide: BuyRepository, useValue: buyRepo },
        { provide: SettingService, useValue: settingService },
        { provide: BuyService, useValue: buyService },
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: BuyCryptoBatchService, useValue: buyCryptoBatchService },
        { provide: BuyCryptoOutService, useValue: buyCryptoOutService },
        { provide: BuyCryptoDexService, useValue: buyCryptoDexService },
        { provide: BuyCryptoNotificationService, useValue: buyCryptoNotificationService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
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
              cryptoInput: createCustomCryptoInput({
                type: CryptoInputType.BUY_CRYPTO,
              }),
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
      createCustomCryptoHistory({
        date: date,
        ...txCrypto,
      }),
    ]);
  });
});
