import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { UserDataService } from 'src/user/models/user-data/user-data.service';
import { UserService } from 'src/user/models/user/user.service';
import { BuyRepository } from '../../buy/buy.repository';
import { CryptoStakingRepository } from '../../crypto-staking/crypto-staking.repository';
import { DepositService } from '../../deposit/deposit.service';
import { createDefaultDeposit } from '../../deposit/__mocks__/deposit.entity.mock';
import { SellRepository } from '../../sell/sell.repository';
import { StakingRefRewardService } from '../../staking-ref-reward/staking-ref-reward.service';
import { StakingRepository } from '../staking.repository';
import { StakingService } from '../staking.service';
import { createCustomStaking } from '../__mocks__/staking.entity.mock';
import { TestUtil } from 'src/shared/test.util';

describe('StakingService', () => {
  let service: StakingService;

  let stakingRepo: StakingRepository;
  let depositService: DepositService;
  let sellRepo: SellRepository;
  let userDataService: UserDataService;
  let cryptoStakingRepo: CryptoStakingRepository;
  let assetService: AssetService;
  let buyRepo: BuyRepository;
  let userService: UserService;
  let stakingRefRewardService: StakingRefRewardService;

  beforeEach(async () => {
    stakingRepo = createMock<StakingRepository>();
    depositService = createMock<DepositService>();
    sellRepo = createMock<SellRepository>();
    userDataService = createMock<UserDataService>();
    cryptoStakingRepo = createMock<CryptoStakingRepository>();
    assetService = createMock<AssetService>();
    buyRepo = createMock<BuyRepository>();
    userService = createMock<UserService>();
    stakingRefRewardService = createMock<StakingRefRewardService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        StakingService,
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: DepositService, useValue: depositService },
        { provide: SellRepository, useValue: sellRepo },
        { provide: UserDataService, useValue: userDataService },
        { provide: CryptoStakingRepository, useValue: cryptoStakingRepo },
        { provide: AssetService, useValue: assetService },
        { provide: BuyRepository, useValue: buyRepo },
        { provide: UserService, useValue: userService },
        { provide: StakingRefRewardService, useValue: stakingRefRewardService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    service = module.get<StakingService>(StakingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should return a min investment of 100 and min deposit of 0.01 for a default staking route', async () => {
    await expect(service.toDto(1, createCustomStaking({ deposit: createDefaultDeposit() }))).resolves.toMatchObject({
      minInvestment: 100,
      minDeposits: [{ amount: 0.01, asset: 'DFI' }],
    });
  });
});
