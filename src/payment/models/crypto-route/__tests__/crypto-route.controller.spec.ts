import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CryptoRouteController } from '../crypto-route.controller';
import { UserService } from 'src/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { StakingRepository } from '../../staking/staking.repository';
import { StakingService } from '../../staking/staking.service';
import { CryptoRouteService } from '../crypto-route.service';
import { BuyCryptoService } from '../../buy-crypto/services/buy-crypto.service';
import { TestUtil } from 'src/shared/test.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createDefaultCryptoRoute } from './mock/crypto-route.entity.mock';

describe('CryptoRouteController', () => {
  let controller: CryptoRouteController;

  let cryptoRouteService: CryptoRouteService;
  let userService: UserService;
  let stakingRepo: StakingRepository;
  let stakingService: StakingService;
  let buyCryptoService: BuyCryptoService;

  beforeEach(async () => {
    cryptoRouteService = createMock<CryptoRouteService>();
    userService = createMock<UserService>();
    stakingRepo = createMock<StakingRepository>();
    stakingService = createMock<StakingService>();
    buyCryptoService = createMock<BuyCryptoService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoRouteController,
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: UserService, useValue: userService },
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: StakingService, useValue: stakingService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<CryptoRouteController>(CryptoRouteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return a min deposit of 0.0005 for a default crypto route', async () => {
    jest.spyOn(cryptoRouteService, 'getUserCryptos').mockResolvedValue([createDefaultCryptoRoute()]);

    await expect(controller.getAllCrypto({ id: 0, address: '', role: UserRole.USER })).resolves.toMatchObject([
      { minDeposit: 0.0005 },
    ]);
  });
});
