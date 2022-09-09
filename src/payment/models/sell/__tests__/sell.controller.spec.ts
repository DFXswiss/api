import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/test.shared.module';
import { UserService } from 'src/user/models/user/user.service';
import { BuyFiatService } from '../../buy-fiat/buy-fiat.service';
import { SellController } from '../sell.controller';
import { SellService } from '../sell.service';
import { TestUtil } from 'src/shared/test.util';
import { createDefaultSell } from '../__mocks__/sell.entity.mock';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Blockchain } from 'src/blockchain/shared/enums/blockchain.enum';

describe('SellController', () => {
  let controller: SellController;

  let sellService: SellService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;

  beforeEach(async () => {
    sellService = createMock<SellService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SellController,
        { provide: SellService, useValue: sellService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<SellController>(SellController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return a min deposit of 0.01 DFI and 1 USD for a default sell route', async () => {
    jest.spyOn(sellService, 'getUserSells').mockResolvedValue([createDefaultSell()]);

    await expect(
      controller.getAllSell({ id: 0, address: '', role: UserRole.USER, blockchains: [Blockchain.DEFICHAIN] }),
    ).resolves.toMatchObject([
      {
        minDeposits: [
          { amount: 0.01, asset: 'DFI' },
          { amount: 1, asset: 'USD' },
        ],
      },
    ]);
  });
});
