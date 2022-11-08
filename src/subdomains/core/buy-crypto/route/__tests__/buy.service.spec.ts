import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyRepository } from './../buy.repository';
import { BuyService } from './../buy.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { StakingService } from 'src/mix/models/staking/staking.service';
import { BankAccountService } from 'src/subdomains/supporting/bank/bank-account/bank-account.service';

describe('BuyService', () => {
  let service: BuyService;

  let buyRepo: BuyRepository;
  let assetService: AssetService;
  let stakingService: StakingService;
  let userService: UserService;
  let bankAccountService: BankAccountService;

  beforeEach(async () => {
    buyRepo = createMock<BuyRepository>();
    assetService = createMock<AssetService>();
    stakingService = createMock<StakingService>();
    userService = createMock<UserService>();
    bankAccountService = createMock<BankAccountService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyService,
        { provide: BuyRepository, useValue: buyRepo },
        { provide: AssetService, useValue: assetService },
        { provide: StakingService, useValue: stakingService },
        { provide: UserService, useValue: userService },
        { provide: BankAccountService, useValue: bankAccountService },
      ],
    }).compile();

    service = module.get<BuyService>(BuyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
