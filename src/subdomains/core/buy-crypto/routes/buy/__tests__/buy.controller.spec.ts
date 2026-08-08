import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutService } from 'src/integration/checkout/services/checkout.service';
import { Config } from 'src/config/config';
import { createCustomAsset } from 'src/shared/models/asset/__mocks__/asset.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { PaymentInfoService } from 'src/shared/services/payment-info.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
import { KycLevel } from 'src/subdomains/generic/user/models/user-data/user-data.enum';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { createCustomVirtualIban } from 'src/subdomains/supporting/bank/virtual-iban/__mocks__/virtual-iban.entity.mock';
import { VirtualIbanMapper } from 'src/subdomains/supporting/bank/virtual-iban/dto/virtual-iban.mapper';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import { QuoteError } from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.enum';
import {
  QuoteErrorUtil,
  QuoteException,
} from 'src/subdomains/supporting/payment/dto/transaction-helper/quote-error.util';
import { TransactionRequestStatus } from 'src/subdomains/supporting/payment/entities/transaction-request.entity';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { BuyCryptoService } from '../../../process/services/buy-crypto.service';
import { createCustomBuy } from '../__mocks__/buy.entity.mock';
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

  let originalInvoiceCurrencies: string[];
  let originalCollectionAccountCurrencies: string[];
  let originalTxRequestWaitingExpiryDays: number;

  const jwt = { user: 1, account: 7, address: '0xabc' } as any;

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

    originalInvoiceCurrencies = [...Config.invoice.currencies];
    originalCollectionAccountCurrencies = [...Config.invoice.collectionAccountCurrencies];
    originalTxRequestWaitingExpiryDays = Config.txRequestWaitingExpiryDays;
  });

  afterEach(() => {
    Config.invoice.currencies = originalInvoiceCurrencies;
    Config.invoice.collectionAccountCurrencies = originalCollectionAccountCurrencies;
    Config.txRequestWaitingExpiryDays = originalTxRequestWaitingExpiryDays;
    jest.restoreAllMocks();
  });

  function setupToDtoDeps() {
    jest.spyOn(transactionHelper, 'getDefaultSpecs').mockReturnValue({
      minDeposit: { amount: 1, asset: 'EUR' },
      minFee: { amount: 0, asset: 'CHF' },
    } as any);
    jest.spyOn(userService, 'getUserFee').mockResolvedValue({
      dfx: { rate: 0.01 },
      network: 0.5,
    } as any);
    jest.spyOn(fiatService, 'getFiatByName').mockResolvedValue({ id: 1, name: 'EUR' } as any);
  }

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllBuy', () => {
    it('returns the DTO list for the user buys', async () => {
      const activeBuy = createCustomBuy({
        id: 1,
        active: true,
        bankUsage: 'ACTIVE-USAGE',
        asset: createCustomAsset({ id: 10 }),
      });
      const inactiveBuy = createCustomBuy({
        id: 2,
        active: false,
        bankUsage: 'INACTIVE-USAGE',
        asset: createCustomAsset({ id: 11 }),
      });
      jest.spyOn(buyService, 'getUserBuys').mockResolvedValue([activeBuy, inactiveBuy] as any);
      setupToDtoDeps();

      const result = await controller.getAllBuy(jwt);

      expect(buyService.getUserBuys).toHaveBeenCalledWith(1);
      expect(result).toHaveLength(2);
      expect(result[0].bankUsage).toBe('ACTIVE-USAGE');
      expect(result[1].bankUsage).toBeUndefined();
    });
  });

  describe('createBuy', () => {
    it('loads the user, runs buyCheck, and creates the buy with the checked dto', async () => {
      const user = { id: 1 } as any;
      const dto = { currency: 'EUR' } as any;
      const checkedDto = { currency: 'EUR', checked: true } as any;
      const buy = createCustomBuy({ id: 5, active: true, asset: createCustomAsset({ id: 10 }) });

      jest.spyOn(userService, 'getUser').mockResolvedValue(user);
      jest.spyOn(paymentInfoService, 'buyCheck').mockResolvedValue(checkedDto);
      jest.spyOn(buyService, 'createBuy').mockResolvedValue(buy as any);
      setupToDtoDeps();

      const result = await controller.createBuy(jwt, dto);

      expect(userService.getUser).toHaveBeenCalledWith(1, { userData: { wallet: true } });
      expect(paymentInfoService.buyCheck).toHaveBeenCalledWith(dto, jwt, user);
      expect(buyService.createBuy).toHaveBeenCalledWith(user, '0xabc', checkedDto);
      expect(result.id).toBe(5);
    });
  });

  describe('getBuyQuote', () => {
    const feeSource = {
      rate: 0.01,
      fixed: 0,
      network: 0,
      min: 0,
      dfx: 1,
      bank: 0,
      bankFixed: 0,
      bankVariable: 0,
      total: 1,
      platform: 0,
    };
    const txDetails = {
      rate: 100,
      exchangeRate: 99,
      estimatedAmount: 0.001,
      sourceAmount: 100,
      minVolume: 10,
      minVolumeTarget: 0.0001,
      maxVolume: 10000,
      maxVolumeTarget: 1,
      feeSource,
      feeTarget: feeSource,
      isValid: true,
      error: undefined,
      errors: [],
      priceSteps: [],
    };

    function checkedQuoteDto(overrides: Record<string, unknown> = {}) {
      return {
        amount: 100,
        currency: { name: 'EUR' },
        asset: { name: 'BTC' },
        targetAmount: undefined,
        paymentMethod: FiatPaymentMethod.BANK,
        specialCode: undefined,
        wallet: 'dfx',
        country: undefined,
        ...overrides,
      } as any;
    }

    it('passes specialCode as a one-element array to getTxDetails', async () => {
      const dto = checkedQuoteDto({ specialCode: 'PROMO' });
      jest.spyOn(paymentInfoService, 'buyCheck').mockResolvedValue(dto);
      jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue(txDetails as any);

      const result = await controller.getBuyQuote(dto);

      expect(transactionHelper.getTxDetails).toHaveBeenCalledWith(
        100,
        undefined,
        dto.currency,
        dto.asset,
        FiatPaymentMethod.BANK,
        expect.anything(),
        false,
        undefined,
        'dfx',
        ['PROMO'],
        undefined,
        undefined,
      );
      expect(result.feeAmount).toBe(1);
      expect(result.isValid).toBe(true);
    });

    it('passes an empty specialCodes array when specialCode is absent', async () => {
      const dto = checkedQuoteDto({ specialCode: undefined });
      jest.spyOn(paymentInfoService, 'buyCheck').mockResolvedValue(dto);
      jest.spyOn(transactionHelper, 'getTxDetails').mockResolvedValue(txDetails as any);

      await controller.getBuyQuote(dto);

      expect(transactionHelper.getTxDetails).toHaveBeenCalledWith(
        100,
        undefined,
        dto.currency,
        dto.asset,
        FiatPaymentMethod.BANK,
        expect.anything(),
        false,
        undefined,
        'dfx',
        [],
        undefined,
        undefined,
      );
    });

    it('returns createErrorQuote when buyCheck throws a QuoteException', async () => {
      const quoteError = new QuoteException(QuoteError.AMOUNT_TOO_LOW);
      jest.spyOn(paymentInfoService, 'buyCheck').mockRejectedValue(quoteError);

      const result = await controller.getBuyQuote(checkedQuoteDto());

      expect(result).toEqual(QuoteErrorUtil.createErrorQuote(quoteError));
      expect(transactionHelper.getTxDetails).not.toHaveBeenCalled();
    });

    it('rethrows non-QuoteException errors from buyCheck', async () => {
      const error = new Error('unexpected');
      jest.spyOn(paymentInfoService, 'buyCheck').mockRejectedValue(error);

      await expect(controller.getBuyQuote(checkedQuoteDto())).rejects.toBe(error);
      expect(transactionHelper.getTxDetails).not.toHaveBeenCalled();
    });
  });

  describe('createBuyWithPaymentInfo', () => {
    it('forwards to buyService.createBuyPaymentInfo', async () => {
      const dto = { amount: 50 } as any;
      const paymentInfo = { iban: 'CH00' } as any;
      jest.spyOn(buyService, 'createBuyPaymentInfo').mockResolvedValue(paymentInfo);

      await expect(controller.createBuyWithPaymentInfo(jwt, dto)).resolves.toBe(paymentInfo);
      expect(buyService.createBuyPaymentInfo).toHaveBeenCalledWith(jwt, dto);
    });
  });

  describe('generateInvoicePDF', () => {
    const userData = { id: 7, isInvoiceDataComplete: true } as any;

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
      Config.invoice.collectionAccountCurrencies = ['EUR'];
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

    it('rejects when user invoice data is incomplete', async () => {
      jest
        .spyOn(transactionRequestService, 'getOrThrow')
        .mockResolvedValue(baseRequest({ userData: { id: 7, isInvoiceDataComplete: false } }));

      await expect(controller.generateInvoicePDF(jwt, 99)).rejects.toThrow(
        new BadRequestException('User data is not complete'),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

    it('rejects when the transaction request is not valid', async () => {
      jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(baseRequest({ isValid: false }));

      await expect(controller.generateInvoicePDF(jwt, 99)).rejects.toThrow(
        new BadRequestException('Transaction request is not valid'),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

    it('rejects when the transaction request is already confirmed', async () => {
      jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(baseRequest({ isComplete: true }));

      await expect(controller.generateInvoicePDF(jwt, 99)).rejects.toThrow(
        new ConflictException('Transaction request is already confirmed'),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

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
        new BadRequestException(QuoteError.COLLECTION_ACCOUNT_INVOICE_PERSONAL_IBAN_MISSING),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

    it('rejects collectionAccount when the currency is not supported for the collection account', async () => {
      setupHappyPath({ currencyName: 'CHF' });

      await expect(controller.generateInvoicePDF(jwt, 99, 'true')).rejects.toThrow(
        new BadRequestException(QuoteError.COLLECTION_ACCOUNT_INVOICE_CURRENCY_NOT_SUPPORTED),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

    it('issues a CHF invoice when the switch is absent, although CHF is no collection-account currency', async () => {
      const { request, buy, bankInfo } = setupHappyPath({ currencyName: 'CHF' });

      await expect(controller.generateInvoicePDF(jwt, 99)).resolves.toEqual({
        pdfData: 'pdf-data',
      });
      expect(buyService.getBankInfoForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ userData, currency: 'CHF' }),
        buy,
        true,
        19,
        501,
        buy.asset,
        {},
      );
      expect(swissQrService.createInvoiceFromRequest).toHaveBeenCalledWith(
        request.amount,
        'CHF',
        bankInfo.reference,
        bankInfo,
        request,
      );
    });

    it('rejects unsupported invoice currencies without collectionAccount after bank resolution', async () => {
      setupHappyPath({ currencyName: 'USD' });

      await expect(controller.generateInvoicePDF(jwt, 99)).rejects.toThrow(
        new Error('PDF invoice is only available for CHF and EUR transactions'),
      );
      expect(buyService.getBankInfoForRequest).toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });

    it('rejects unsupported currencies with collectionAccount before bank resolution', async () => {
      setupHappyPath({ currencyName: 'USD' });

      await expect(controller.generateInvoicePDF(jwt, 99, 'true')).rejects.toThrow(
        new BadRequestException(QuoteError.COLLECTION_ACCOUNT_INVOICE_CURRENCY_NOT_SUPPORTED),
      );
      expect(buyService.getBankInfoForRequest).not.toHaveBeenCalled();
      expect(swissQrService.createInvoiceFromRequest).not.toHaveBeenCalled();
    });
  });

  describe('confirmBuy', () => {
    function baseConfirmRequest(overrides: Record<string, unknown> = {}) {
      return {
        id: 99,
        isValid: true,
        status: TransactionRequestStatus.CREATED,
        created: new Date(),
        ...overrides,
      } as any;
    }

    it('rejects when the transaction request is not valid', async () => {
      jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(baseConfirmRequest({ isValid: false }));

      await expect(controller.confirmBuy(jwt, 99)).rejects.toThrow(
        new BadRequestException('Transaction request is not valid'),
      );
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it('rejects when the request status is COMPLETED', async () => {
      jest
        .spyOn(transactionRequestService, 'getOrThrow')
        .mockResolvedValue(baseConfirmRequest({ status: TransactionRequestStatus.COMPLETED }));

      await expect(controller.confirmBuy(jwt, 99)).rejects.toThrow(
        new ConflictException('Transaction request is already confirmed'),
      );
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it('rejects when the request status is WAITING_FOR_PAYMENT', async () => {
      jest
        .spyOn(transactionRequestService, 'getOrThrow')
        .mockResolvedValue(baseConfirmRequest({ status: TransactionRequestStatus.WAITING_FOR_PAYMENT }));

      await expect(controller.confirmBuy(jwt, 99)).rejects.toThrow(
        new ConflictException('Transaction request is already confirmed'),
      );
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it('rejects when the transaction request is expired', async () => {
      Config.txRequestWaitingExpiryDays = 7;
      jest.spyOn(Util, 'daysDiff').mockReturnValue(7);

      const request = baseConfirmRequest();
      jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(request);

      await expect(controller.confirmBuy(jwt, 99)).rejects.toThrow(
        new BadRequestException('Transaction request is expired'),
      );
      expect(transactionRequestService.confirmTransactionRequest).not.toHaveBeenCalled();
    });

    it('confirms a valid, non-expired request', async () => {
      Config.txRequestWaitingExpiryDays = 7;
      jest.spyOn(Util, 'daysDiff').mockReturnValue(0);

      const request = baseConfirmRequest();
      jest.spyOn(transactionRequestService, 'getOrThrow').mockResolvedValue(request);
      jest.spyOn(transactionRequestService, 'confirmTransactionRequest').mockResolvedValue(undefined as any);

      await expect(controller.confirmBuy(jwt, 99)).resolves.toBeUndefined();
      expect(transactionRequestService.confirmTransactionRequest).toHaveBeenCalledWith(request);
    });
  });

  describe('getAllPersonalIbans', () => {
    it('maps virtual IBANs through VirtualIbanMapper.toDto', async () => {
      const virtualIban = createCustomVirtualIban({ id: 3 });
      const dto = { id: 3, iban: 'DE123' } as any;
      jest.spyOn(virtualIbanService, 'getVirtualIbansForAccount').mockResolvedValue([virtualIban] as any);
      jest.spyOn(VirtualIbanMapper, 'toDto').mockReturnValue(dto);

      await expect(controller.getAllPersonalIbans(jwt)).resolves.toEqual([dto]);
      expect(virtualIbanService.getVirtualIbansForAccount).toHaveBeenCalledWith(7);
      // Array.map passes (item, index, array); assert the mapped item is the loaded vIBAN.
      expect(VirtualIbanMapper.toDto).toHaveBeenCalledWith(virtualIban, 0, [virtualIban]);
    });
  });

  describe('createPersonalIban', () => {
    it('rejects when KYC level is below 50', async () => {
      jest.spyOn(userDataService, 'getActiveUserData').mockResolvedValue({ kycLevel: KycLevel.LEVEL_20 } as any);

      await expect(controller.createPersonalIban(jwt, { currency: 'EUR' } as any)).rejects.toThrow(
        new BadRequestException('KYC level 50 or higher required for personal IBAN'),
      );
      expect(virtualIbanService.createForUser).not.toHaveBeenCalled();
    });

    it('creates a personal IBAN when KYC level is sufficient', async () => {
      const userData = { id: 7, kycLevel: KycLevel.LEVEL_50 } as any;
      const virtualIban = createCustomVirtualIban({ id: 9 });
      const dto = { id: 9, iban: 'DE999' } as any;

      jest.spyOn(userDataService, 'getActiveUserData').mockResolvedValue(userData);
      jest.spyOn(virtualIbanService, 'createForUser').mockResolvedValue(virtualIban as any);
      jest.spyOn(VirtualIbanMapper, 'toDto').mockReturnValue(dto);

      await expect(controller.createPersonalIban(jwt, { currency: 'EUR' } as any)).resolves.toBe(dto);
      expect(virtualIbanService.createForUser).toHaveBeenCalledWith(userData, 'EUR');
    });
  });

  describe('updateBuyRoute', () => {
    it('updates the buy and returns its DTO', async () => {
      const buy = createCustomBuy({ id: 8, active: true, asset: createCustomAsset({ id: 10 }) });
      const dto = { active: false } as any;
      jest.spyOn(buyService, 'updateBuy').mockResolvedValue(buy as any);
      setupToDtoDeps();

      const result = await controller.updateBuyRoute(jwt, 8, dto);

      expect(buyService.updateBuy).toHaveBeenCalledWith(1, 8, dto);
      expect(result.id).toBe(8);
    });
  });

  describe('getBuy', () => {
    it('returns the DTO for a single buy route', async () => {
      const buy = createCustomBuy({
        id: 4,
        active: true,
        bankUsage: 'ROUTE-USAGE',
        asset: createCustomAsset({ id: 10 }),
      });
      jest.spyOn(buyService, 'get').mockResolvedValue(buy as any);
      setupToDtoDeps();

      const result = await controller.getBuy(jwt, 4);

      expect(buyService.get).toHaveBeenCalledWith(7, 4);
      expect(result.id).toBe(4);
      expect(result.bankUsage).toBe('ROUTE-USAGE');
    });
  });

  describe('getBuyRouteHistory', () => {
    it('forwards to buyCryptoService.getBuyHistory', async () => {
      const history = [{ inputAmount: 10 }] as any;
      jest.spyOn(buyCryptoService, 'getBuyHistory').mockResolvedValue(history);

      await expect(controller.getBuyRouteHistory(jwt, 4)).resolves.toBe(history);
      expect(buyCryptoService.getBuyHistory).toHaveBeenCalledWith(1, 4);
    });
  });
});
