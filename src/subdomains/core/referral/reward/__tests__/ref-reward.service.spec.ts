import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionRepository } from 'src/subdomains/supporting/payment/repositories/transaction.repository';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RefRewardRepository } from '../ref-reward.repository';
import { RefRewardService } from '../services/ref-reward.service';

function mockQueryBuilder(candidates: any[]) {
  const qb: any = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(candidates),
  };
  return qb;
}

describe('RefRewardService', () => {
  let service: RefRewardService;

  let rewardRepo: RefRewardRepository;
  let userService: UserService;
  let pricingService: PricingService;
  let assetService: AssetService;
  let transactionService: TransactionService;
  let settingService: SettingService;
  let transactionRepo: TransactionRepository;

  beforeEach(async () => {
    rewardRepo = createMock<RefRewardRepository>();
    userService = createMock<UserService>();
    pricingService = createMock<PricingService>();
    assetService = createMock<AssetService>();
    transactionService = createMock<TransactionService>();
    settingService = createMock<SettingService>();
    transactionRepo = createMock<TransactionRepository>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefRewardService,
        { provide: RefRewardRepository, useValue: rewardRepo },
        { provide: UserService, useValue: userService },
        { provide: PricingService, useValue: pricingService },
        { provide: AssetService, useValue: assetService },
        { provide: TransactionService, useValue: transactionService },
        { provide: SettingService, useValue: settingService },
        { provide: TransactionRepository, useValue: transactionRepo },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<RefRewardService>(RefRewardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOpenRefCreditLiability', () => {
    it('converts the open EUR credit to CHF', async () => {
      jest.spyOn(userService, 'getOpenRefCreditEur').mockResolvedValue(1000);
      const convert = jest.fn().mockReturnValue(920);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert } as any);

      const result = await service.getOpenRefCreditLiability();

      expect(result).toEqual({ amountEur: 1000, amountChf: 920 });
      expect(convert).toHaveBeenCalledWith(1000, 8);
    });

    it('returns zero without fetching a price when nothing is owed', async () => {
      jest.spyOn(userService, 'getOpenRefCreditEur').mockResolvedValue(0);
      const getPrice = jest.spyOn(pricingService, 'getPrice');

      const result = await service.getOpenRefCreditLiability();

      expect(result).toEqual({ amountEur: 0, amountChf: 0 });
      expect(getPrice).not.toHaveBeenCalled();
    });
  });

  describe('createRefBonusRewards', () => {
    const agreement = {
      usedRef: 'AAA-000',
      userId: 1,
      outputAssetId: 2,
      feeShare: 0.5,
      minTransactionId: 0,
    };

    const user = {
      id: 1,
      address: 'addr-1',
      ref: 'AAA-000',
      refVolume: 0,
      refCredit: 0,
      refFeePercent: 1,
      userData: { id: 10 },
    } as any;

    const asset = { id: 2, blockchain: 'Ethereum' } as any;

    it('does nothing when no agreements are configured', async () => {
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) =>
        key === 'refBonusAgreements' ? [] : defaultValue,
      );

      await service.createRefBonusRewards();

      expect(transactionRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(rewardRepo.save).not.toHaveBeenCalled();
    });

    it('saves amountInEur as the configured share of an EUR fee', async () => {
      const agreements = [agreement];
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) =>
        key === 'refBonusAgreements' ? agreements : defaultValue,
      );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(transactionRepo, 'createQueryBuilder').mockReturnValue(
        mockQueryBuilder([
          {
            id: 100,
            buyCrypto: { absoluteFeeAmount: 6200, inputReferenceAsset: 'EUR' },
          },
        ]),
      );
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledWith(expect.objectContaining({ amountInEur: 3100 }));
    });

    it('converts a non-EUR fee before applying the fee share', async () => {
      const agreements = [agreement];
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) =>
        key === 'refBonusAgreements' ? agreements : defaultValue,
      );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from: string) => {
        if (from === 'CHF') {
          return { convert: (amount: number) => amount * 0.95 } as any;
        }
        return { convert: (amount: number) => amount * 0.9 } as any;
      });
      jest.spyOn(transactionRepo, 'createQueryBuilder').mockReturnValue(
        mockQueryBuilder([
          {
            id: 100,
            buyCrypto: { absoluteFeeAmount: 800, inputReferenceAsset: 'CHF' },
          },
        ]),
      );
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledWith(expect.objectContaining({ amountInEur: 380 }));
    });

    it('continues processing remaining candidates when one price lookup fails', async () => {
      const agreements = [agreement];
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) =>
        key === 'refBonusAgreements' ? agreements : defaultValue,
      );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from: string) => {
        if (from === 'CHF') {
          return Promise.reject(new Error('price unavailable'));
        }
        return { convert: (amount: number) => amount * 0.9 } as any;
      });
      jest.spyOn(transactionRepo, 'createQueryBuilder').mockReturnValue(
        mockQueryBuilder([
          {
            id: 200,
            buyCrypto: { absoluteFeeAmount: 800, inputReferenceAsset: 'CHF' },
          },
          {
            id: 201,
            buyCrypto: { absoluteFeeAmount: 6200, inputReferenceAsset: 'EUR' },
          },
        ]),
      );
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).toHaveBeenCalledTimes(1);
      expect(rewardRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          amountInEur: 3100,
          sourceTransaction: expect.objectContaining({ id: 201 }),
        }),
      );
    });

    it('converts a sell-side crypto fee via the cryptoInput asset before applying the fee share', async () => {
      const agreements = [agreement];
      const feeAsset = { id: 3, name: 'BTC' } as any;
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) =>
        key === 'refBonusAgreements' ? agreements : defaultValue,
      );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockImplementation(async (from: any) => {
        if (from === feeAsset) {
          return { convert: (amount: number) => amount * 100 } as any;
        }
        return { convert: (amount: number) => amount * 0.9 } as any;
      });
      jest.spyOn(transactionRepo, 'createQueryBuilder').mockReturnValue(
        mockQueryBuilder([
          {
            id: 100,
            buyFiat: {
              absoluteFeeAmount: 5,
              cryptoInput: { asset: feeAsset },
            },
          },
        ]),
      );
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      // fee 5 * 100 EUR = 500, feeShare 0.5 -> amountInEur 250
      expect(rewardRepo.save).toHaveBeenCalledWith(expect.objectContaining({ amountInEur: 250 }));
    });

    it('skips a sell-side candidate when cryptoInput asset is missing', async () => {
      const agreements = [agreement];
      jest.spyOn(settingService, 'getObj').mockImplementation(async (key: string, defaultValue?: any) =>
        key === 'refBonusAgreements' ? agreements : defaultValue,
      );
      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(assetService, 'getAssetById').mockResolvedValue(asset);
      jest.spyOn(pricingService, 'getPrice').mockResolvedValue({ convert: (amount: number) => amount * 0.9 } as any);
      jest.spyOn(transactionRepo, 'createQueryBuilder').mockReturnValue(
        mockQueryBuilder([
          {
            id: 100,
            buyFiat: {
              absoluteFeeAmount: 5,
              cryptoInput: undefined,
            },
          },
        ]),
      );
      jest.spyOn(rewardRepo, 'create').mockImplementation((e) => e as any);
      jest.spyOn(transactionService, 'create').mockResolvedValue({} as any);
      jest.spyOn(userService, 'updateRefVolume').mockResolvedValue(undefined as any);
      jest.spyOn(rewardRepo, 'save').mockResolvedValue({} as any);

      await service.createRefBonusRewards();

      expect(rewardRepo.save).not.toHaveBeenCalled();
    });
  });
});
