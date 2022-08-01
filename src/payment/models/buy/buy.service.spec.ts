import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UserService } from 'src/user/models/user/user.service';
import { BankAccountService } from '../bank-account/bank-account.service';
import { StakingService } from '../staking/staking.service';
import { BuyRepository } from './buy.repository';
import { BuyService } from './buy.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { BuyCryptoRepository } from '../buy-crypto/repositories/buy-crypto.repository';
import { BuyHistoryDto } from './dto/buy-history.dto';
import { createCustomBuyHistory } from './dto/__tests__/mock/buy-history.dto.mock';

enum MockBuyData {
  DEFAULT,
  BUY_HISTORY_EMPTY,
  BUY_HISTORY,
  BUY_HISTORY_SMALL,
}

describe('BuyService', () => {
  let service: BuyService;

  let buyRepo: BuyRepository;
  let buyCryptoRepo: BuyCryptoRepository;
  let assetService: AssetService;
  let stakingService: StakingService;
  let userService: UserService;
  let bankAccountService: BankAccountService;

  beforeEach(async () => {
    buyRepo = createMock<BuyRepository>();
    buyCryptoRepo = createMock<BuyCryptoRepository>();
    assetService = createMock<AssetService>();
    stakingService = createMock<StakingService>();
    userService = createMock<UserService>();
    bankAccountService = createMock<BankAccountService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyService,
        { provide: BuyRepository, useValue: buyRepo },
        { provide: BuyCryptoRepository, useValue: buyCryptoRepo },
        { provide: AssetService, useValue: assetService },
        { provide: StakingService, useValue: stakingService },
        { provide: UserService, useValue: userService },
        { provide: BankAccountService, useValue: bankAccountService },
      ],
    }).compile();

    service = module.get<BuyService>(BuyService);
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

  function setup(mock: MockBuyData) {
    if (mock !== MockBuyData.DEFAULT) {
      let wantedData: BuyHistoryDto[] = [];
      switch (mock) {
        case MockBuyData.BUY_HISTORY:
          wantedData = [createCustomBuyHistory(txOne), createCustomBuyHistory(txTwo)];
          break;
        case MockBuyData.BUY_HISTORY_SMALL:
          wantedData = [createCustomBuyHistory(txSmallAmount)];
      }

      const queryBuilder: any = {
        select: () => queryBuilder,
        addSelect: () => queryBuilder,
        leftJoin: () => queryBuilder,
        where: () => queryBuilder,
        andWhere: () => queryBuilder,
        getRawMany: () => wantedData,
      };
      jest.spyOn(buyCryptoRepo, 'createQueryBuilder').mockImplementation(() => queryBuilder);
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return an empty array, if buy route has no history', async () => {
    setup(MockBuyData.BUY_HISTORY_EMPTY);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([]);
  });

  it('should return a history, if buy route has transactions', async () => {
    setup(MockBuyData.BUY_HISTORY);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyHistory({
        inputAmount: 1,
        inputAsset: 'EUR',
        outputAmount: 0.00005,
        outputAsset: 'BTC',
      }),
      createCustomBuyHistory({
        inputAmount: 10,
        inputAsset: 'EUR',
        outputAmount: 0.0005,
        outputAsset: 'BTC',
      }),
    ]);
  });

  it('should return a history, if buy route has transactions and show small amount correctly', async () => {
    setup(MockBuyData.BUY_HISTORY_SMALL);

    await expect(service.getHistory(1, 1)).resolves.toStrictEqual([
      createCustomBuyHistory({
        inputAmount: 1,
        inputAsset: 'EUR',
        outputAmount: 0.00000003,
        outputAsset: 'GOOGL',
      }),
    ]);
  });
});
