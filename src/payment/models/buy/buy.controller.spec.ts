import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { BuyService } from '../../../payment/models/buy/buy.service';
import { BuyController } from './buy.controller';
import { UserService } from 'src/user/models/user/user.service';
import { User } from 'src/user/models/user/user.entity';
import { TestSharedModule } from 'src/shared/test.shared.module';

describe('BuyController', () => {
  let controller: BuyController;
  
  let buyService: BuyService;
  let userService: UserService;

  function setup(volume: number, refUser?: Partial<User>) {
    jest.spyOn(buyService, 'getUserVolume').mockResolvedValueOnce({ volume: 0, annualVolume: volume });
    jest.spyOn(userService, 'getRefUser').mockResolvedValueOnce(refUser as User);
  }

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyController,
        { provide: BuyService, useValue: buyService },
        { provide: UserService, useValue: userService },
      ],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // ref bonus
  it('should return base fee when no ref user', async () => {
    setup(0);

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 2.9, refBonus: 0 });
  });

  it('should return 0.5% bonus from ref user', async () => {
    setup(0, { refFeePercent: 0.5 });

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 2.4, refBonus: 0.5 });
  });

  it('should return 0.9% bonus from ref user', async () => {
    setup(0, { refFeePercent: 0.1 });

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 2.0, refBonus: 0.9 });
  });

  // volume
  it('should return base fee when volume < 5000', async () => {
    setup(4999.99);

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 2.9, refBonus: 0 });
  });

  it('should return 1.75 when volume = 5000 and ref user', async () => {
    setup(5000, { refFeePercent: 0.1 });

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 1.75, refBonus: 0.9 });
  });

  it('should return 2.4 when volume > 50000', async () => {
    setup(64358);

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 2.4, refBonus: 0 });
  });

  // > 100'000
  it('should return 1.4 and no bonus when volume > 100000 and no ref user', async () => {
    setup(100000);

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 1.4, refBonus: 0 });
  });

  it('should return 1.4 and no bonus when volume > 100000 and ref user', async () => {
    setup(100000, { refFeePercent: 0.5 });

    await expect(controller.getFees(1)).resolves.toStrictEqual({ fee: 1.4, refBonus: 0 });
  });
});
