import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { createCustomAsset } from 'src/shared/models/asset/__tests__/mock/asset.entity.mock';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { createCustomBuyCrypto } from '../../buy-crypto/entities/__tests__/mock/buy-crypto.entity.mock';
import { CryptoInput } from '../crypto-input.entity';
import { CryptoInputRepository } from '../crypto-input.repository';
import { CryptoInputService } from '../crypto-input.service';
import { createCustomCryptoInputHistory } from '../dto/__tests__/mock/crypto-input-history.dto.mock';
import { createCustomCryptoInput } from './mock/crypto-input.entity.mock';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
}

describe('CryptoInputService', () => {
  let service: CryptoInputService;

  let cryptoInputRepo: CryptoInputRepository;

  beforeEach(async () => {
    cryptoInputRepo = createMock<CryptoInputRepository>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [CryptoInputService, { provide: CryptoInputRepository, useValue: cryptoInputRepo }],
    }).compile();

    service = module.get<CryptoInputService>(CryptoInputService);
  });

  const txOne = {
    inputAmount: 1,
    inputAsset: 'BTC',
    outputAmount: 0.988,
    outputAsset: 'BTC',
    txId: 'TX_INPUT_ID_0',
  };

  function createEntry(tx: any, date?: Date): CryptoInput {
    return createCustomCryptoInput({
      amount: tx.inputAmount,
      asset: createCustomAsset({ dexName: tx.inputAsset }),
      buyCrypto: createCustomBuyCrypto({ outputAmount: tx.outputAmount, outputAsset: tx.outputAsset, txId: tx.txId }),
      created: date,
    });
  }

  function setup(mock: MockBuyData, date?: Date) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: CryptoInput[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [createEntry(txOne, date)];
          break;
      }

      jest.spyOn(cryptoInputRepo, 'find').mockResolvedValue(wantedData);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array, if crypto route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if crypto route has transactions', async () => {
    const date = new Date();
    setup(MockBuyData.BUY_HISTORY, date);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomCryptoInputHistory({
        date: date,
        ...txOne,
      }),
    ]);
  });
});
