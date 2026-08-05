import { createMock } from '@golevelup/ts-jest';
import { BadRequestException } from '@nestjs/common';
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
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
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

  describe('generateInvoicePDF', () => {
    const userData = { id: 7, isInvoiceDataComplete: true } as any;
    const jwt = { user: 1, account: 7 } as any;

    function baseRequest(overrides: Record<string, unknown> = {}) {
      return {
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
        ...overrides,
      } as any;
    }

    function baseBuy(overrides: Record<string, unknown> = {}) {
      return { id: 42, asset: { id: 10 }, bankUsage: 'ABCD-EFGH-IJKL', ...overrides } as any;
    }

    function setupHappyPath(options?: { request?: any; buy?: any; currencyName?: string; bankInfo?: any }) {
      Config.invoice.currencies = ['EUR', 'CHF'];
      const request = options?.request ?? baseRequest();
      const buy = options?.buy ?? baseBuy();
      const bankInfo =
        options?.bankInfo ??
        ({
          iban: 'LI32088110105923K000C',
          reference: 'ABCD-EFGH-IJKL',
          isPersonalIban: false,
        } as any);
      jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(request);
      jest.spyOn(userService, 'getUser').mockResolvedValue({ wallet: {} } as any);
      jest.spyOn(buyService, 'get').mockResolvedValue(buy);
      jest.spyOn(fiatService, 'getFiat').mockResolvedValue({ id: 2, name: options?.currencyName ?? 'EUR' } as any);
      jest.spyOn(buyService, 'getBankInfoForRequest').mockResolvedValue(bankInfo);
      jest.spyOn(swissQrService, 'createInvoiceFromRequest').mockResolvedValue('pdf-data');
      return { request, buy, bankInfo };
    }

    it('passes the persisted bank and virtual-IBAN IDs into invoice bank resolution when collectionAccount is omitted', async () => {
      const { request, buy, bankInfo } = setupHappyPath();

      await expect(controller.generateInvoicePDF(jwt, 99)).resolves.toEqual({
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
      expect(swissQrService.createInvoiceFromRequest).toHaveBeenCalledWith(
        request.amount,
        'EUR',
        bankInfo.reference,
        bankInfo,
        request,
      );
    });

    it("skips the virtual IBAN when collectionAccount is the string 'true'", async () => {
      const collectionBankInfo = {
        iban: 'LI32088110105923K000C',
        reference: 'ABCD-EFGH-IJKL',
        isPersonalIban: false,
      } as any;
      const { request, buy } = setupHappyPath({ bankInfo: collectionBankInfo });

      await expect(controller.generateInvoicePDF(jwt, 99, 'true')).resolves.toEqual({
        pdfData: 'pdf-data',
      });
      expect(buyService.getBankInfoForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ userData, currency: 'EUR' }),
        buy,
        true,
        19,
        undefined,
        buy.asset,
        {},
      );
      expect(swissQrService.createInvoiceFromRequest).toHaveBeenCalledWith(
        request.amount,
        'EUR',
        collectionBankInfo.reference,
        collectionBankInfo,
        request,
      );
    });

    it("still passes the virtual IBAN when collectionAccount is the string 'false'", async () => {
      const personalBankInfo = {
        iban: 'LI75088110105923K000E',
        reference: 'ABCD-EFGH-IJKL',
        isPersonalIban: true,
      } as any;
      const { request, buy } = setupHappyPath({ bankInfo: personalBankInfo });

      await expect(controller.generateInvoicePDF(jwt, 99, 'false')).resolves.toEqual({
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
      expect(swissQrService.createInvoiceFromRequest).toHaveBeenCalledWith(
        request.amount,
        'EUR',
        personalBankInfo.reference,
        personalBankInfo,
        request,
      );
    });

    it('rejects collectionAccount when the request has no personal virtual IBAN', async () => {
      setupHappyPath({ request: baseRequest({ virtualIbanId: undefined }) });

      await expect(controller.generateInvoicePDF(jwt, 99, 'true')).rejects.toThrow(
        new BadRequestException(QuoteError.COLLECTION_ACCOUNT_INVOICE_REQUIRES_PERSONAL_IBAN),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

    it('rejects collectionAccount when the currency is not EUR', async () => {
      setupHappyPath({ currencyName: 'CHF' });

      await expect(controller.generateInvoicePDF(jwt, 99, 'true')).rejects.toThrow(
        new BadRequestException(QuoteError.COLLECTION_ACCOUNT_INVOICE_CURRENCY_NOT_SUPPORTED),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });
  });
});
