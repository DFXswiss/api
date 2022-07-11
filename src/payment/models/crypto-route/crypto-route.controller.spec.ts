import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CryptoRouteController } from './crypto-route.controller';
import { UserService } from 'src/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { StakingRepository } from '../staking/staking.repository';
import { StakingService } from '../staking/staking.service';
import { CryptoRouteService } from './crypto-route.service';

describe('CryptoRouteController', () => {
  let controller: CryptoRouteController;

  let cryptoRouteService: CryptoRouteService;
  let userService: UserService;
  let stakingRepo: StakingRepository;
  let stakingService: StakingService;

  beforeEach(async () => {
    cryptoRouteService = createMock<CryptoRouteService>();
    userService = createMock<UserService>();
    stakingRepo = createMock<StakingRepository>();
    stakingService = createMock<StakingService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoRouteController,
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: UserService, useValue: userService },
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: StakingService, useValue: stakingService },
      ],
    }).compile();

    controller = module.get<CryptoRouteController>(CryptoRouteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
