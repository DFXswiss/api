import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { BuyService } from '../buy.service';
import { BuyController } from '../buy.controller';
import { UserService } from 'src/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { StakingRepository } from '../../staking/staking.repository';
import { StakingService } from '../../staking/staking.service';
import { BuyCryptoService } from '../../buy-crypto/services/buy-crypto.service';
import { createDefaultBuy } from './mock/buy.entity.mock';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { TestUtil } from 'src/shared/test.util';
import { Blockchain } from 'src/ain/services/crypto.service';

describe('BuyController', () => {
  let controller: BuyController;

  let buyService: BuyService;
  let userService: UserService;
  let stakingRepo: StakingRepository;
  let stakingService: StakingService;
  let buyCryptoService: BuyCryptoService;

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    stakingRepo = createMock<StakingRepository>();
    stakingService = createMock<StakingService>();
    buyCryptoService = createMock<BuyCryptoService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyController,
        { provide: BuyService, useValue: buyService },
        { provide: UserService, useValue: userService },
        { provide: StakingRepository, useValue: stakingRepo },
        { provide: StakingService, useValue: stakingService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return a min deposit of 1 for a default buy route', async () => {
    jest.spyOn(buyService, 'getUserBuys').mockResolvedValue([createDefaultBuy()]);

    await expect(controller.getAllBuy({ id: 0, address: '', role: UserRole.USER, blockchains: [Blockchain.DEFICHAIN] })).resolves.toMatchObject([
      { minDeposits: [{ amount: 1, asset: 'USD' }] },
    ]);
  });
});
