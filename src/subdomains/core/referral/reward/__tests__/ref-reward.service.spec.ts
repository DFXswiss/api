import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { RefRewardRepository } from '../ref-reward.repository';
import { RefRewardService } from '../services/ref-reward.service';

describe('RefRewardService', () => {
  let service: RefRewardService;

  let rewardRepo: RefRewardRepository;
  let userService: UserService;
  let pricingService: PricingService;
  let assetService: AssetService;
  let transactionService: TransactionService;
  let settingService: SettingService;

  beforeEach(async () => {
    rewardRepo = createMock<RefRewardRepository>();
    userService = createMock<UserService>();
    pricingService = createMock<PricingService>();
    assetService = createMock<AssetService>();
    transactionService = createMock<TransactionService>();
    settingService = createMock<SettingService>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RefRewardService,
        { provide: RefRewardRepository, useValue: rewardRepo },
        { provide: UserService, useValue: userService },
        { provide: PricingService, useValue: pricingService },
        { provide: AssetService, useValue: assetService },
        { provide: TransactionService, useValue: transactionService },
        { provide: SettingService, useValue: settingService },
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
});
