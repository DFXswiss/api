import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { RouteService } from 'src/subdomains/core/route/route.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyRepository } from '../buy.repository';
import { BuyService } from '../buy.service';

describe('BuyService', () => {
  let service: BuyService;

  let buyRepo: BuyRepository;
  let userService: UserService;
  let routeService: RouteService;
  let transactionHelper: TransactionHelper;
  let swissQrService: SwissQRService;
  let paymentInfoService: PaymentInfoService;
  let bankService: BankService;
  let transactionRequestService: TransactionRequestService;
  let checkoutService: CheckoutService;
  let virtualIbanService: VirtualIbanService;

  beforeEach(async () => {
    buyRepo = createMock<BuyRepository>();
    userService = createMock<UserService>();
    routeService = createMock<RouteService>();
    paymentInfoService = createMock<PaymentInfoService>();
    swissQrService = createMock<SwissQRService>();
    bankService = createMock<BankService>();
    transactionRequestService = createMock<TransactionRequestService>();
    transactionHelper = createMock<TransactionHelper>();
    checkoutService = createMock<CheckoutService>();
    virtualIbanService = createMock<VirtualIbanService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BuyService,
        { provide: BuyRepository, useValue: buyRepo },
        { provide: UserService, useValue: userService },
        { provide: RouteService, useValue: routeService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: SwissQRService, useValue: swissQrService },
        { provide: PaymentInfoService, useValue: paymentInfoService },
        { provide: BankService, useValue: bankService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: CheckoutService, useValue: checkoutService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
      ],
    }).compile();

    service = module.get<BuyService>(BuyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
