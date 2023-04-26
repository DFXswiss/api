import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { CryptoRouteController } from '../crypto-route.controller';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { CryptoRouteService } from '../crypto-route.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TransactionHelper } from 'src/shared/payment/services/transaction-helper';

describe('CryptoRouteController', () => {
  let controller: CryptoRouteController;

  let cryptoRouteService: CryptoRouteService;
  let userService: UserService;
  let buyCryptoService: BuyCryptoService;
  let paymentInfoService: PaymentInfoService;
  let transactionHelper: TransactionHelper;

  beforeEach(async () => {
    cryptoRouteService = createMock<CryptoRouteService>();
    userService = createMock<UserService>();
    buyCryptoService = createMock<BuyCryptoService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionHelper = createMock<TransactionHelper>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        CryptoRouteController,
        { provide: CryptoRouteService, useValue: cryptoRouteService },
        { provide: UserService, useValue: userService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: TransactionHelper, useValue: transactionHelper },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<CryptoRouteController>(CryptoRouteController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
