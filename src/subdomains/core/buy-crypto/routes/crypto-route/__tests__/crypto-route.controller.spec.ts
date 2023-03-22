import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CryptoRouteController } from '../crypto-route.controller';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CryptoRouteService } from '../crypto-route.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { createDefaultCryptoRoute } from '../__mocks__/crypto-route.entity.mock';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';

describe('CryptoRouteController', () => {
  let controller: CryptoRouteController;

  let cryptoRouteService: CryptoRouteService;
  let userService: UserService;
  let buyCryptoService: BuyCryptoService;
  let paymentInfoService: PaymentInfoService;

  beforeEach(async () => {
    cryptoRouteService = createMock<CryptoRouteService>();
    userService = createMock<UserService>();
    buyCryptoService = createMock<BuyCryptoService>();
    paymentInfoService = createMock<PaymentInfoService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoRouteController,
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: UserService, useValue: userService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
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

    await expect(
      controller.getAllCrypto({ id: 0, address: '', role: UserRole.USER, blockchains: [Blockchain.DEFICHAIN] }),
    ).resolves.toMatchObject([{ minDeposits: [{ amount: 0.0005, asset: 'BTC' }] }]);
  });
});
