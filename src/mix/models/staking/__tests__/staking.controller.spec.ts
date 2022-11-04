import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CryptoStakingService } from '../../crypto-staking/crypto-staking.service';
import { StakingController } from '../staking.controller';
import { StakingService } from '../staking.service';

describe('StakingController', () => {
  let controller: StakingController;

  let stakingService: StakingService;
  let cryptoStakingService: CryptoStakingService;

  beforeEach(async () => {
    stakingService = createMock<StakingService>();
    cryptoStakingService = createMock<CryptoStakingService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        StakingController,
        { provide: StakingService, useValue: stakingService },
        { provide: CryptoStakingService, useValue: cryptoStakingService },
      ],
    }).compile();

    controller = module.get<StakingController>(StakingController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
