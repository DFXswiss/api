import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { createDefaultFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { AmlService } from 'src/subdomains/core/aml/services/aml.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { WebhookService } from 'src/subdomains/generic/user/services/webhook/webhook.service';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { createCustomFiatOutput } from 'src/subdomains/supporting/fiat-output/__mocks__/fiat-output.entity.mock';
import { FiatOutputService } from 'src/subdomains/supporting/fiat-output/fiat-output.service';
import { createCustomCryptoInput } from 'src/subdomains/supporting/payin/entities/__mocks__/crypto-input.entity.mock';
import { PayInService } from 'src/subdomains/supporting/payin/services/payin.service';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { createCustomSellHistory } from '../../route/dto/__mocks__/sell-history.dto.mock';
import { SellRepository } from '../../route/sell.repository';
import { SellService } from '../../route/sell.service';
import { createCustomBuyFiat } from '../__mocks__/buy-fiat.entity.mock';
import { BuyFiat } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatNotificationService } from '../services/buy-fiat-notification.service';
import { BuyFiatService } from '../services/buy-fiat.service';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
  BUY_HISTORY_SMALL,
}

describe('BuyFiatService', () => {
  let service: BuyFiatService;

  let buyFiatRepo: BuyFiatRepository;
  let userService: UserService;
  let sellRepo: SellRepository;
  let sellService: SellService;
  let bankTxService: BankTxService;
  let fiatOutputService: FiatOutputService;
  let buyCryptoService: BuyCryptoService;
  let webhookService: WebhookService;
  let fiatService: FiatService;
  let transactionRequestService: TransactionRequestService;
  let bankDataService: BankDataService;
  let transactionService: TransactionService;
  let payInService: PayInService;
  let userDataService: UserDataService;
  let buyFiatNotificationService: BuyFiatNotificationService;
  let amlService: AmlService;

  beforeEach(async () => {
    buyFiatRepo = createMock<BuyFiatRepository>();
    userService = createMock<UserService>();
    sellRepo = createMock<SellRepository>();
    sellService = createMock<SellService>();
    bankTxService = createMock<BankTxService>();
    fiatOutputService = createMock<FiatOutputService>();
    buyCryptoService = createMock<BuyCryptoService>();
    webhookService = createMock<WebhookService>();
    fiatService = createMock<FiatService>();
    transactionRequestService = createMock<TransactionRequestService>();
    bankDataService = createMock<BankDataService>();
    transactionService = createMock<TransactionService>();
    payInService = createMock<PayInService>();
    userDataService = createMock<UserDataService>();
    buyFiatNotificationService = createMock<BuyFiatNotificationService>();
    amlService = createMock<AmlService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyFiatService,
        { provide: BuyFiatRepository, useValue: buyFiatRepo },
        { provide: UserService, useValue: userService },
        { provide: SellRepository, useValue: sellRepo },
        { provide: SellService, useValue: sellService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: FiatOutputService, useValue: fiatOutputService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: WebhookService, useValue: webhookService },
        { provide: FiatService, useValue: fiatService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: TransactionService, useValue: transactionService },
        { provide: PayInService, useValue: payInService },
        { provide: UserDataService, useValue: userDataService },
        { provide: BuyFiatNotificationService, useValue: buyFiatNotificationService },
        { provide: AmlService, useValue: amlService },
      ],
    }).compile();

    service = module.get<BuyFiatService>(BuyFiatService);
  });

  const txOne = {
    inputAmount: 0.00005,
    inputAsset: 'BTC',
    outputAmount: 1,
    outputAsset: createDefaultFiat(),
  };

  const txTwo = {
    inputAmount: 0.0005,
    inputAsset: 'BTC',
    outputAmount: 10,
    outputAsset: createDefaultFiat(),
  };

  const txSmallAmount = {
    inputAmount: 3e-8,
    inputAsset: 'GOOGL',
    outputAmount: 1,
    outputAsset: createDefaultFiat(),
  };

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyFiat[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [
            createCustomBuyFiat({
              fiatOutput: createCustomFiatOutput({ outputDate: date }),
              cryptoInput: createCustomCryptoInput({ inTxId: 'IN_TX_ID_0' }),
              ...txOne,
            }),
            createCustomBuyFiat({
              fiatOutput: createCustomFiatOutput({ outputDate: date }),
              cryptoInput: createCustomCryptoInput({ inTxId: 'IN_TX_ID_1' }),
              ...txTwo,
            }),
          ];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [
            createCustomBuyFiat({
              fiatOutput: createCustomFiatOutput({ outputDate: date }),
              cryptoInput: createCustomCryptoInput({ created: date, inTxId: 'IN_TX_ID_0' }),
              ...txSmallAmount,
            }),
          ];
      }

      jest.spyOn(buyFiatRepo, 'find').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array, if sell route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getSellHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if sell route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getSellHistory(1, 1)).resolves.toStrictEqual([
      createCustomSellHistory({
        date: date,
        txId: 'IN_TX_ID_0',
        txUrl: 'https://defiscan.live/transactions/IN_TX_ID_0',
        ...txOne,
        outputAsset: txOne.outputAsset.name,
      }),
      createCustomSellHistory({
        date: date,
        txId: 'IN_TX_ID_1',
        txUrl: 'https://defiscan.live/transactions/IN_TX_ID_1',
        ...txTwo,
        outputAsset: txTwo.outputAsset.name,
      }),
    ]);
  });

  it('should return a history, if sell route has transactions and show small amount correctly', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY_SMALL, date);

    await expect(service.getSellHistory(1, 1)).resolves.toStrictEqual([
      createCustomSellHistory({
        date: date,
        txId: 'IN_TX_ID_0',
        txUrl: 'https://defiscan.live/transactions/IN_TX_ID_0',
        ...txSmallAmount,
        outputAsset: txSmallAmount.outputAsset.name,
      }),
    ]);
  });
});
