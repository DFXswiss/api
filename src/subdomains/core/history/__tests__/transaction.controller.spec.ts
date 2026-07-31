import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Config } from 'src/config/config';
import { JwtPayload } from 'src/shared/auth/jwt-payload.interface';
import { UserRole } from 'src/shared/auth/user-role.enum';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { AccountType } from 'src/subdomains/generic/user/models/user-data/account-type.enum';
import { createCustomUserData } from 'src/subdomains/generic/user/models/user-data/__mocks__/user-data.entity.mock';
import { UserDataService } from 'src/subdomains/generic/user/models/user-data/user-data.service';
import { createCustomUser } from 'src/subdomains/generic/user/models/user/__mocks__/user.entity.mock';
import { BankTxReturnService } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.service';
import { createDefaultBankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/__mocks__/bank-tx.entity.mock';
import { BankTxService } from 'src/subdomains/supporting/bank-tx/bank-tx/services/bank-tx.service';
import { createDefaultBank } from 'src/subdomains/supporting/bank/bank/__mocks__/bank.entity.mock';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { createCustomTransactionRequest } from 'src/subdomains/supporting/payment/__mocks__/transaction-request.entity.mock';
import { createCustomTransaction } from 'src/subdomains/supporting/payment/__mocks__/transaction.entity.mock';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { FiatPaymentMethod } from 'src/subdomains/supporting/payment/dto/payment-method.enum';
import {
  TxStatementDetails,
  TxStatementType,
} from 'src/subdomains/supporting/payment/dto/transaction-helper/tx-statement-details.dto';
import { SwissQRService } from 'src/subdomains/supporting/payment/services/swiss-qr.service';
import { TransactionHelper } from 'src/subdomains/supporting/payment/services/transaction-helper';
import { TransactionRequestService } from 'src/subdomains/supporting/payment/services/transaction-request.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { CheckStatus } from '../../aml/enums/check-status.enum';
import { createCustomBuyCrypto } from '../../buy-crypto/process/entities/__mocks__/buy-crypto.entity.mock';
import { BuyCryptoWebhookService } from '../../buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyService } from '../../buy-crypto/routes/buy/buy.service';
import { BuyFiatService } from '../../sell-crypto/process/services/buy-fiat.service';
import { TransactionUtilService } from '../../transaction/transaction-util.service';
import { TransactionController } from '../controllers/transaction.controller';
import { HistoryAccessService } from '../services/history-access.service';
import { HistoryService } from '../services/history.service';

describe('TransactionController', () => {
  let controller: TransactionController;

  let historyService: HistoryService;
  let historyAccessService: HistoryAccessService;
  let transactionService: TransactionService;
  let buyCryptoWebhookService: BuyCryptoWebhookService;
  let buyFiatService: BuyFiatService;
  let bankDataService: BankDataService;
  let bankTxService: BankTxService;
  let fiatService: FiatService;
  let buyService: BuyService;
  let buyCryptoService: BuyCryptoService;
  let transactionUtilService: TransactionUtilService;
  let userDataService: UserDataService;
  let bankTxReturnService: BankTxReturnService;
  let transactionRequestService: TransactionRequestService;
  let bankService: BankService;
  let transactionHelper: TransactionHelper;
  let swissQrService: SwissQRService;
  let virtualIbanService: VirtualIbanService;

  beforeEach(async () => {
    historyService = createMock<HistoryService>();
    historyAccessService = createMock<HistoryAccessService>();
    transactionService = createMock<TransactionService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    buyFiatService = createMock<BuyFiatService>();
    bankDataService = createMock<BankDataService>();
    bankTxService = createMock<BankTxService>();
    fiatService = createMock<FiatService>();
    buyService = createMock<BuyService>();
    buyCryptoService = createMock<BuyCryptoService>();
    transactionUtilService = createMock<TransactionUtilService>();
    userDataService = createMock<UserDataService>();
    bankTxReturnService = createMock<BankTxReturnService>();
    transactionRequestService = createMock<TransactionRequestService>();
    bankService = createMock<BankService>();
    transactionHelper = createMock<TransactionHelper>();
    swissQrService = createMock<SwissQRService>();
    virtualIbanService = createMock<VirtualIbanService>();

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        TransactionController,
        { provide: HistoryService, useValue: historyService },
        { provide: HistoryAccessService, useValue: historyAccessService },
        { provide: TransactionService, useValue: transactionService },
        { provide: BuyCryptoWebhookService, useValue: buyCryptoWebhookService },
        { provide: BuyFiatService, useValue: buyFiatService },
        { provide: BankDataService, useValue: bankDataService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: FiatService, useValue: fiatService },
        { provide: BuyService, useValue: buyService },
        { provide: BuyCryptoService, useValue: buyCryptoService },
        { provide: TransactionUtilService, useValue: transactionUtilService },
        { provide: UserDataService, useValue: userDataService },
        { provide: BankTxReturnService, useValue: bankTxReturnService },
        { provide: TransactionRequestService, useValue: transactionRequestService },
        { provide: BankService, useValue: bankService },
        { provide: TransactionHelper, useValue: transactionHelper },
        { provide: SwissQRService, useValue: swissQrService },
        { provide: VirtualIbanService, useValue: virtualIbanService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    controller = module.get<TransactionController>(TransactionController);
  });

  const jwt: JwtPayload = {
    role: UserRole.ACCOUNT,
    ip: '1.1.1.1',
    account: 1,
  };

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return buyCrypto refund data', async () => {
    jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(
      createCustomTransaction({
        buyCrypto: createCustomBuyCrypto({
          amlCheck: CheckStatus.FAIL,
          bankTx: createDefaultBankTx(),
        }),
        bankTx: createDefaultBankTx(),
      }),
    );

    jest.spyOn(transactionUtilService, 'validateChargebackIban').mockResolvedValue(true);
    jest.spyOn(bankService, 'getBankByIban').mockResolvedValue(createDefaultBank());

    await expect(controller.getTransactionRefund(jwt, 1)).resolves.toBeDefined();
  });

  describe('generateInvoiceFromTransaction (UID / TransactionRequest path)', () => {
    const uid = 'Q186C06388387A6FD';
    const userData = createCustomUserData({
      id: 1,
      accountType: AccountType.PERSONAL,
      firstname: 'Test',
      surname: 'User',
    });
    const buy = {
      id: 42,
      asset: { id: 10 },
      user: { wallet: { id: 3 } },
    } as any;
    const bankInfo = { iban: 'LI75088110105923K000E', reference: 'ABCD-EFGH-IJKL' } as any;

    function setupUidRequest(isComplete: boolean) {
      Config.invoice.currencies = ['EUR', 'CHF'];
      const request = createCustomTransactionRequest({
        uid,
        amount: 100,
        bankId: 19,
        virtualIbanId: 501,
        isValid: true,
        isComplete,
        routeId: 42,
        sourceId: 2,
        sourcePaymentMethod: FiatPaymentMethod.BANK,
        user: createCustomUser({ userData }),
      });
      jest.spyOn(transactionRequestService, 'getTransactionRequestByUid').mockResolvedValue(request);
      jest.spyOn(fiatService, 'getFiat').mockResolvedValue({ id: 2, name: 'EUR' } as any);
      jest.spyOn(buyService, 'get').mockResolvedValue(buy);
      jest.spyOn(buyService, 'getBankInfoForRequest').mockResolvedValue(bankInfo);
      jest.spyOn(swissQrService, 'createInvoiceFromRequest').mockResolvedValue('pdf-data');
      return request;
    }

    it('passes requireLiveVirtualIban=false for a completed UID-resolved TransactionRequest', async () => {
      const request = setupUidRequest(true);

      await expect(controller.generateInvoiceFromTransaction(jwt, uid)).resolves.toEqual({ pdfData: 'pdf-data' });

      expect(buyService.getBankInfoForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, currency: 'EUR', userData }),
        buy,
        false,
        request.bankId,
        request.virtualIbanId,
        buy.asset,
        buy.user.wallet,
      );
      expect(transactionHelper.getTxStatementDetails).not.toHaveBeenCalled();
    });

    it('passes requireLiveVirtualIban=true for an incomplete UID-resolved TransactionRequest', async () => {
      const request = setupUidRequest(false);

      await expect(controller.generateInvoiceFromTransaction(jwt, uid)).resolves.toEqual({ pdfData: 'pdf-data' });

      expect(buyService.getBankInfoForRequest).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100, currency: 'EUR', userData }),
        buy,
        true,
        request.bankId,
        request.virtualIbanId,
        buy.asset,
        buy.user.wallet,
      );
      expect(transactionHelper.getTxStatementDetails).not.toHaveBeenCalled();
    });
  });

  describe('getSingleTransactionDetails (malformed id / order-id)', () => {
    // Both guards reject rather than drop, because id and order-id are the primary selectors here
    // rather than one of several optional lookup keys.
    it.each(['NaN', 'Infinity', '1.9', '1e+21', '-1', '0', '2147483648', 'abc'])(
      'rejects id=%j before it reaches the lookup',
      async (id) => {
        await expect(controller.getSingleTransactionDetails(jwt, id)).rejects.toBeInstanceOf(BadRequestException);

        expect(transactionService.getTransactionById).not.toHaveBeenCalled();
      },
    );

    it.each(['NaN', 'Infinity', '1e+21', '2147483648', 'abc'])(
      'rejects order-id=%j before it reaches the lookup',
      async (orderId) => {
        await expect(controller.getSingleTransactionDetails(jwt, undefined, undefined, orderId)).rejects.toBeInstanceOf(
          BadRequestException,
        );

        expect(transactionService.getTransactionByRequestId).not.toHaveBeenCalled();
      },
    );

    it('passes a well-formed id through as a number', async () => {
      jest.spyOn(transactionService, 'getTransactionById').mockResolvedValue(undefined);

      await expect(controller.getSingleTransactionDetails(jwt, ' 42 ')).rejects.toBeInstanceOf(NotFoundException);

      expect(transactionService.getTransactionById).toHaveBeenCalledWith(42, expect.any(Object));
    });
  });

  describe('generateInvoiceFromTransaction (malformed id)', () => {
    // Regression: `isNaN(+id)` classified all of these as numeric ids, so they reached Postgres as
    // integers and came back as `invalid input syntax for type integer` -> 500. None of them can be a
    // real transaction id, so they must go down the UID path instead and never be coerced to a number.
    const malformedIds = ['NaN', 'Infinity', '1.9', '1e+21', '-1', '99999999999', '0x10', 'abc'];

    beforeEach(() => {
      Config.invoice.currencies = ['EUR', 'CHF'];
      jest.spyOn(transactionRequestService, 'getTransactionRequestByUid').mockResolvedValue(undefined);
      // Resolves rather than rejects on purpose: a rejecting mock would make the assertions below
      // pass regardless of how the id was classified, which is the bug this pins.
      jest
        .spyOn(transactionHelper, 'getTxStatementDetails')
        .mockResolvedValue({ currency: 'EUR' } as unknown as TxStatementDetails);
      jest.spyOn(swissQrService, 'createTxStatement').mockResolvedValue('pdf-data');
    });

    it.each(malformedIds)('passes %j through as a UID, never as a numeric id', async (id) => {
      await controller.generateInvoiceFromTransaction(jwt, id);

      expect(transactionHelper.getTxStatementDetails).toHaveBeenCalledWith(jwt.account, id, TxStatementType.INVOICE);
    });

    // A query string decodes `+` to a space, so `/v1/transaction/+42/invoice` arrives padded; it
    // resolved as id 42 before the guard existed and still must.
    it.each(['42', ' 42 '])('still resolves the well-formed numeric id %j to a number', async (id) => {
      await controller.generateInvoiceFromTransaction(jwt, id);

      expect(transactionHelper.getTxStatementDetails).toHaveBeenCalledWith(jwt.account, 42, TxStatementType.INVOICE);
    });

    it('guards the receipt endpoint the same way', async () => {
      await controller.generateReceiptFromTransaction(jwt, 'Infinity');

      expect(transactionHelper.getTxStatementDetails).toHaveBeenCalledWith(
        jwt.account,
        'Infinity',
        TxStatementType.RECEIPT,
      );
    });
  });
});
