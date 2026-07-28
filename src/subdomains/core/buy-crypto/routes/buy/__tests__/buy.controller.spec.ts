import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { Config } from 'src/config/config';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
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
  let fiatService: FiatService;
  let swissQrService: SwissQRService;
  let virtualIbanService: VirtualIbanService;
  let userDataService: UserDataService;

  beforeEach(async () => {
    buyService = createMock<BuyService>();
    userService = createMock<UserService>();
    buyCryptoService = createMock<BuyCryptoService>();
    bankService = createMock<BankService>();
    paymentInfoService = createMock<PaymentInfoService>();
    transactionHelper = createMock<TransactionHelper>();
    checkoutService = createMock<CheckoutService>();
    transactionRequestService = createMock<TransactionRequestService>();
    fiatService = createMock<FiatService>();
    swissQrService = createMock<SwissQRService>();
    virtualIbanService = createMock<VirtualIbanService>();
    userDataService = createMock<UserDataService>();

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
        { provide: FiatService, useValue: fiatService },
        { provide: SwissQRService, useValue: swissQrService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        { provide: UserDataService, useValue: userDataService },

        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<BuyController>(BuyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('passes the persisted bank and virtual-IBAN IDs into invoice bank resolution', async () => {
    Config.invoice.currencies = ['EUR'];
    const userData = { id: 7, isInvoiceDataComplete: true } as any;
    const request = {
      id: 99,
      userData,
      isValid: true,
      isComplete: false,
      routeId: 42,
      sourceId: 2,
      amount: 100,
      sourcePaymentMethod: FiatPaymentMethod.BANK,
      bankId: 19,
      virtualIbanId: 501,
    } as any;
    const buy = { id: 42, asset: { id: 10 } } as any;
    const bankInfo = { iban: 'LI75088110105923K000E', reference: 'ABCD-EFGH-IJKL' } as any;
    jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(request);
    jest.spyOn(userService, 'getUser').mockResolvedValue({ wallet: {} } as any);
    jest.spyOn(buyService, 'get').mockResolvedValue(buy);
    jest.spyOn(fiatService, 'getFiat').mockResolvedValue({ id: 2, name: 'EUR' } as any);
    jest.spyOn(buyService, 'getBankInfoForRequest').mockResolvedValue(bankInfo);
    jest.spyOn(swissQrService, 'createInvoiceFromRequest').mockResolvedValue('pdf-data');

    await expect(controller.generateInvoicePDF({ user: 1, account: 7 } as any, 99)).resolves.toEqual({
      pdfData: 'pdf-data',
    });
    expect(buyService.getBankInfoForRequest).toHaveBeenCalledWith(
      expect.objectContaining({ userData, currency: 'EUR' }),
      buy,
      true,
      19,
      501,
      buy.asset,
      {},
    );
  });
});
