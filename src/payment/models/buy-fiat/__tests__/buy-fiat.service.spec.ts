import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { UserService } from 'src/user/models/user/user.service';
import { BankTxRepository } from '../../bank-tx/bank-tx.repository';
import { createCustomCryptoInput } from '../../crypto-input/__mocks__/crypto-input.entity.mock';
import { SellRepository } from '../../sell/sell.repository';
import { SellService } from '../../sell/sell.service';
import { BuyFiat } from '../buy-fiat.entity';
import { BuyFiatRepository } from '../buy-fiat.repository';
import { BuyFiatService } from '../buy-fiat.service';
import { createCustomBuyFiatHistory } from '../dto/__tests__/mock/buy-fiat-history.dto.mock';
import { createCustomBuyFiat } from '../__mocks__/buy-fiat.entity.mock';

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
  let bankTxRepo: BankTxRepository;

  beforeEach(async () => {
    buyFiatRepo = createMock<BuyFiatRepository>();
    userService = createMock<UserService>();
    sellRepo = createMock<SellRepository>();
    sellService = createMock<SellService>();
    bankTxRepo = createMock<BankTxRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyFiatService,
        { provide: BuyFiatRepository, useValue: buyFiatRepo },
        { provide: UserService, useValue: userService },
        { provide: SellRepository, useValue: sellRepo },
        { provide: SellService, useValue: sellService },
        { provide: BankTxRepository, useValue: bankTxRepo },
      ],
    }).compile();

    service = module.get<BuyFiatService>(BuyFiatService);
  });

  const txOne = {
    inputAmount: 0.00005,
    inputAsset: 'BTC',
    outputAmount: 1,
    outputAsset: 'EUR',
  };

  const txTwo = {
    inputAmount: 0.0005,
    inputAsset: 'BTC',
    outputAmount: 10,
    outputAsset: 'EUR',
  };

  const txSmallAmount = {
    inputAmount: 3e-8,
    inputAsset: 'GOOGL',
    outputAmount: 1,
    outputAsset: 'EUR',
  };

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyFiat[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [
            createCustomBuyFiat({
              outputDate: date,
              cryptoInput: createCustomCryptoInput({ inTxId: 'IN_TX_ID_0' }),
              ...txOne,
            }),
            createCustomBuyFiat({
              outputDate: date,
              cryptoInput: createCustomCryptoInput({ inTxId: 'IN_TX_ID_1' }),
              ...txTwo,
            }),
          ];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [
            createCustomBuyFiat({
              outputDate: date,
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

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if sell route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyFiatHistory({
        date: date,
        txId: 'IN_TX_ID_0',
        ...txOne,
      }),
      createCustomBuyFiatHistory({
        date: date,
        txId: 'IN_TX_ID_1',
        ...txTwo,
      }),
    ]);
  });

  it('should return a history, if sell route has transactions and show small amount correctly', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY_SMALL, date);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyFiatHistory({
        date: date,
        txId: 'IN_TX_ID_0',
        ...txSmallAmount,
      }),
    ]);
  });
});
