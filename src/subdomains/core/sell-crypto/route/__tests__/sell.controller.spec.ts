import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BuyFiatService } from '../../process/buy-fiat.service';
import { SellController } from '../sell.controller';
import { SellService } from '../sell.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { createCustomSell, createDefaultSell } from '../__mocks__/sell.entity.mock';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { createCustomDeposit } from 'src/subdomains/supporting/address-pool/deposit/__mocks__/deposit.entity.mock';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';

describe('SellController', () => {
  let controller: SellController;

  let sellService: SellService;
  let userService: UserService;
  let buyFiatService: BuyFiatService;
  let paymentInfoService: PaymentInfoService;

  beforeEach(async () => {
    sellService = createMock<SellService>();
    userService = createMock<UserService>();
    buyFiatService = createMock<BuyFiatService>();
    paymentInfoService = createMock<PaymentInfoService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        SellController,
        { provide: SellService, useValue: sellService },
        { provide: UserService, useValue: userService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<SellController>(SellController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return a min deposit of 1 EUR for a default sell route', async () => {
    jest.spyOn(sellService, 'getUserSells').mockResolvedValue([createDefaultSell()]);

    await expect(
      controller.getAllSell({ id: 0, address: '', role: UserRole.USER, blockchains: [Blockchain.DEFICHAIN] }),
    ).resolves.toMatchObject([
      {
        minDeposits: [{ amount: 1, asset: 'EUR' }],
      },
    ]);
  });

  it('should return a min deposit of 0.0005 BTC for a Bitcoin sell route', async () => {
    jest.spyOn(sellService, 'getUserSells').mockResolvedValue([
      createCustomSell({
        deposit: createCustomDeposit({ blockchain: Blockchain.BITCOIN }),
      }),
    ]);

    await expect(
      controller.getAllSell({ id: 0, address: '', role: UserRole.USER, blockchains: [Blockchain.DEFICHAIN] }),
    ).resolves.toMatchObject([
      {
        minDeposits: [{ amount: 0.0005, asset: 'BTC' }],
      },
    ]);
  });

  it('should return a min deposit of 1000 USD for a Bitcoin sell route to USD', async () => {
    jest.spyOn(sellService, 'getUserSells').mockResolvedValue([
      createCustomSell({
        deposit: createCustomDeposit({ blockchain: Blockchain.BITCOIN }),
        fiat: createCustomFiat({ name: 'USD' }),
      }),
    ]);

    await expect(
      controller.getAllSell({ id: 0, address: '', role: UserRole.USER, blockchains: [Blockchain.DEFICHAIN] }),
    ).resolves.toMatchObject([
      {
        minDeposits: [{ amount: 1000, asset: 'USD' }],
      },
    ]);
  });
});
