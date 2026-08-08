import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Subject } from 'rxjs';
import {
  FiatRepublicPaymentDirection,
  FiatRepublicPaymentResponse,
  FiatRepublicPaymentStatus,
} from 'src/integration/bank/dto/fiat-republic.dto';
import { FiatRepublicWebhookService } from 'src/integration/bank/services/fiat-republic-webhook.service';
import { FiatRepublicService } from 'src/integration/bank/services/fiat-republic.service';
import { YapealWebhookService } from 'src/integration/bank/services/yapeal-webhook.service';
import { TestSharedModule } from 'src/shared/utils/test.shared.module';
import { TestUtil } from 'src/shared/utils/test.util';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { BankTransactionEvent, BankTransactionHandler } from '../bank-transaction-handler.service';
import { BankTxFiatRepublicService } from '../bank-tx-fiat-republic.service';
import { BankTxService } from '../bank-tx.service';

function payment(overrides: Partial<FiatRepublicPaymentResponse> = {}): FiatRepublicPaymentResponse {
  return {
    id: 'pmt_synthetic',
    direction: FiatRepublicPaymentDirection.PAYIN,
    reference: 'Deposit',
    amount: '100.00',
    currency: 'EUR',
    paymentScheme: 'SCT',
    status: FiatRepublicPaymentStatus.COMPLETED,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('BankTransactionHandler', () => {
  let handler: BankTransactionHandler;
  let yapealWebhookService: DeepMocked<YapealWebhookService>;
  let fiatRepublicWebhookService: DeepMocked<FiatRepublicWebhookService>;
  let fiatRepublicService: DeepMocked<FiatRepublicService>;
  let bankTxFiatRepublicService: DeepMocked<BankTxFiatRepublicService>;
  let bankTxService: DeepMocked<BankTxService>;
  let specialAccountService: DeepMocked<SpecialExternalAccountService>;
  let yapealSubject: Subject<BankTransactionEvent>;
  let fiatRepublicSubject: Subject<FiatRepublicPaymentResponse>;

  beforeEach(async () => {
    yapealSubject = new Subject<BankTransactionEvent>();
    fiatRepublicSubject = new Subject<FiatRepublicPaymentResponse>();

    yapealWebhookService = createMock<YapealWebhookService>();
    fiatRepublicWebhookService = createMock<FiatRepublicWebhookService>();
    fiatRepublicService = createMock<FiatRepublicService>();
    bankTxFiatRepublicService = createMock<BankTxFiatRepublicService>();
    bankTxService = createMock<BankTxService>();
    specialAccountService = createMock<SpecialExternalAccountService>();

    yapealWebhookService.getTransactionObservable.mockReturnValue(yapealSubject.asObservable());
    fiatRepublicWebhookService.getPaymentObservable.mockReturnValue(fiatRepublicSubject.asObservable());
    jest.spyOn(fiatRepublicService, 'isBankTxSyncEnabled').mockReturnValue(true);
    specialAccountService.getMultiAccounts.mockResolvedValue([]);
    bankTxFiatRepublicService.toBankTx.mockResolvedValue({ accountServiceRef: 'pmt_synthetic' });

    const module: TestingModule = await Test.createTestingModule({
      imports: [TestSharedModule],
      providers: [
        BankTransactionHandler,
        { provide: YapealWebhookService, useValue: yapealWebhookService },
        { provide: FiatRepublicWebhookService, useValue: fiatRepublicWebhookService },
        { provide: FiatRepublicService, useValue: fiatRepublicService },
        { provide: BankTxFiatRepublicService, useValue: bankTxFiatRepublicService },
        { provide: BankTxService, useValue: bankTxService },
        { provide: SpecialExternalAccountService, useValue: specialAccountService },
        TestUtil.provideConfig(),
      ],
    }).compile();

    handler = module.get<BankTransactionHandler>(BankTransactionHandler);
    handler.onModuleInit();
  });

  afterEach(() => jest.restoreAllMocks());

  /** The subscriptions are fire-and-forget, so the assertions need one microtask turn to settle. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  describe('Yapeal', () => {
    it('books a webhook transaction', async () => {
      yapealSubject.next({ accountIban: 'CH00', bankTxData: { accountServiceRef: 'ref' } });
      await settle();

      expect(bankTxService.create).toHaveBeenCalledWith({ accountServiceRef: 'ref' }, []);
    });

    it('swallows a duplicate', async () => {
      bankTxService.create.mockRejectedValue(new ConflictException('duplicate'));

      yapealSubject.next({ accountIban: 'CH00', bankTxData: { accountServiceRef: 'ref' } });

      await expect(settle()).resolves.toBeUndefined();
    });

    it('swallows any other failure', async () => {
      bankTxService.create.mockRejectedValue(new Error('database down'));

      yapealSubject.next({ accountIban: 'CH00', bankTxData: { accountServiceRef: 'ref' } });

      await expect(settle()).resolves.toBeUndefined();
    });
  });

  describe('Fiat Republic', () => {
    it('books a completed payin', async () => {
      fiatRepublicSubject.next(payment());
      await settle();

      expect(bankTxFiatRepublicService.toBankTx).toHaveBeenCalledWith(expect.objectContaining({ id: 'pmt_synthetic' }));
      expect(bankTxService.create).toHaveBeenCalledWith({ accountServiceRef: 'pmt_synthetic' }, []);
    });

    it('does not book a payment held for compliance review', async () => {
      fiatRepublicSubject.next(payment({ status: FiatRepublicPaymentStatus.COMPLIANCE_REVIEW }));
      await settle();

      expect(bankTxService.create).not.toHaveBeenCalled();
    });

    it.each([
      FiatRepublicPaymentStatus.CREATED,
      FiatRepublicPaymentStatus.PROCESSING,
      FiatRepublicPaymentStatus.FAILED,
      FiatRepublicPaymentStatus.RETURNED,
    ])('does not book a payment in status %s', async (status) => {
      fiatRepublicSubject.next(payment({ status }));
      await settle();

      expect(bankTxService.create).not.toHaveBeenCalled();
    });

    it('ignores everything while the bank-tx sync stage is not released', async () => {
      jest.spyOn(fiatRepublicService, 'isBankTxSyncEnabled').mockReturnValue(false);

      fiatRepublicSubject.next(payment());
      await settle();

      expect(bankTxFiatRepublicService.toBankTx).not.toHaveBeenCalled();
      expect(bankTxService.create).not.toHaveBeenCalled();
    });

    it('swallows a duplicate the polling backstop already imported', async () => {
      bankTxService.create.mockRejectedValue(new ConflictException('duplicate'));

      fiatRepublicSubject.next(payment());

      await expect(settle()).resolves.toBeUndefined();
    });

    it('swallows a mapping failure without killing the subscription', async () => {
      bankTxFiatRepublicService.toBankTx.mockRejectedValueOnce(new Error('no bank row'));

      fiatRepublicSubject.next(payment());
      await settle();

      bankTxFiatRepublicService.toBankTx.mockResolvedValue({ accountServiceRef: 'pmt_second' });
      fiatRepublicSubject.next(payment({ id: 'pmt_second' }));
      await settle();

      expect(bankTxService.create).toHaveBeenCalledWith({ accountServiceRef: 'pmt_second' }, []);
    });
  });
});
