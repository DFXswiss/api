import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { BuyCryptoService } from '../../../process/services/buy-crypto.service';
import { BuyController } from '../buy.controller';
import { BuyService } from '../buy.service';

describe('BuyController', () => {
  let controller: BuyController;

  let buyService: BuyService;
  let userService: UserService;
  let buyCryptoService: BuyCryptoService;
  let bankService: BankService;
  let paymentInfoService: PaymentInfoService;
  let transactionHelper: TransactionHelper;
  let checkoutService: CheckoutService;
  let transactionRequestService: TransactionRequestService;
  let transactionService: TransactionService;
  let fiatService: FiatService;
  let swissQrService: SwissQRService;

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    buyCryptoService = createMock<BuyCryptoService>();
    bankService = createMock<BankService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionHelper = createMock<TransactionHelper>();
    checkoutService = createMock<CheckoutService>();
    transactionRequestService = createMock<TransactionRequestService>();
    transactionService = createMock<TransactionService>();
    fiatService = createMock<FiatService>();
    swissQrService = createMock<SwissQRService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyController,
        { provide: BuyService, useValue: buyService },
        { provide: UserService, useValue: userService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: BankService, useValue: bankService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: CheckoutService, useValue: checkoutService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: TransactionService, useValue: transactionService },
        { provide: FiatService, useValue: fiatService },
        { provide: SwissQRService, useValue: swissQrService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
