import { createMock } from '@golevelup/ts-jest';
import { ForbiddenException } from '@nestjs/common';
import { Util } from 'src/shared/utils/util';
import { BuyCryptoWebhookService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto-webhook.service';
import { BuyFiatService } from 'src/subdomains/core/sell-crypto/process/services/buy-fiat.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { UserService } from 'src/subdomains/generic/user/models/user/user.service';
import { Wallet, WebhookConfigOption } from 'src/subdomains/generic/user/models/wallet/wallet.entity';
import { WalletService } from 'src/subdomains/generic/user/models/wallet/wallet.service';
import { PaymentWebhookData } from 'src/subdomains/generic/user/services/webhook/dto/payment-webhook.dto';
import { TransactionState, TransactionType } from 'src/subdomains/supporting/payment/dto/transaction.dto';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PARTNER_PAYMENT_OMITTED_FIELDS } from '../../dto/partner-payment.dto';
import { KycDocumentService } from '../integration/kyc-document.service';
import { KycClientService } from '../kyc-client.service';

describe('KycClientService payments API gate', () => {
  let service: KycClientService;
  let walletService: jest.Mocked<WalletService>;
  let transactionService: jest.Mocked<TransactionService>;
  let buyCryptoWebhookService: jest.Mocked<BuyCryptoWebhookService>;
  let buyFiatService: jest.Mocked<BuyFiatService>;

  // Single clock anchor; ranges and fixture dates derived so they do not go calendar-stale.
  const TEST_NOW = new Date();
  const dateFrom = Util.daysBefore(30, TEST_NOW);
  const dateTo = Util.daysAfter(30, TEST_NOW);

  const userDataWith = (kycClients?: string): UserData => Object.assign(new UserData(), { id: 1, kycClients });

  const userWith = (id: number, address: string, kycClients?: string) =>
    ({
      id,
      address,
      userData: userDataWith(kycClients),
    }) as Wallet['users'][number];

  const paymentConfig = (payment: WebhookConfigOption) => JSON.stringify({ payment, kyc: WebhookConfigOption.TRUE });

  const walletWith = (overrides: {
    paymentsApiEnabled?: boolean;
    paymentOption?: WebhookConfigOption;
    users?: Wallet['users'];
  }): Wallet =>
    Object.assign(new Wallet(), {
      id: 7,
      users: overrides.users ?? [userWith(42, '0xUSER')],
      ...(overrides.paymentsApiEnabled === undefined ? {} : { paymentsApiEnabled: overrides.paymentsApiEnabled }),
      webhookConfig: paymentConfig(overrides.paymentOption ?? WebhookConfigOption.TRUE),
    });

  /** Full PaymentWebhookData with every omitted field set to a non-empty sentinel. */
  const fullPaymentPayload = (): PaymentWebhookData =>
    ({
      id: 99,
      uid: 'T99',
      orderUid: 'O1',
      type: TransactionType.BUY,
      state: TransactionState.COMPLETED,
      inputAmount: 100,
      inputAsset: 'EUR',
      inputAssetId: 1,
      inputChainId: null,
      inputBlockchain: null,
      inputEvmChainId: null,
      inputPaymentMethod: undefined,
      inputTxId: 'SENSITIVE_INPUT_TX',
      inputTxUrl: 'https://explorer/SENSITIVE_INPUT_TX',
      depositAddress: 'SENSITIVE_DEPOSIT',
      chargebackTarget: 'SENSITIVE_CHARGEBACK_TARGET',
      chargebackAmount: 5,
      chargebackAsset: 'EUR',
      chargebackAssetId: 1,
      chargebackTxId: 'SENSITIVE_CHARGEBACK_TX',
      chargebackTxUrl: 'https://explorer/SENSITIVE_CHARGEBACK_TX',
      // Ordered chargebackDate < date < outputDate (same relative order as the previous fixed calendar values).
      chargebackDate: Util.daysBefore(2, TEST_NOW),
      date: Util.daysBefore(1, TEST_NOW),
      reason: undefined,
      exchangeRate: 1.1,
      rate: 1.05,
      outputAmount: 90,
      outputAsset: 'BTC',
      outputAssetId: 2,
      outputChainId: null,
      outputBlockchain: undefined,
      outputEvmChainId: null,
      outputPaymentMethod: undefined,
      outputTxId: 'SENSITIVE_OUTPUT_TX',
      outputTxUrl: 'https://explorer/SENSITIVE_OUTPUT_TX',
      outputDate: new Date(TEST_NOW),
      priceSteps: [],
      feeAmount: 1,
      feeAsset: 'EUR',
      fees: undefined,
      externalTransactionId: 'partner-ext-1',
      networkStartTx: {
        txId: 'SENSITIVE_NETWORK_TX',
        txUrl: 'https://explorer/SENSITIVE_NETWORK_TX',
        amount: 0.001,
        exchangeRate: 1,
        asset: 'ETH',
      },
      sourceAccount: 'CH9300762011623852957',
      targetAccount: '0xDEADBEEF',
      dfxReference: 12345,
    }) as PaymentWebhookData;

  beforeEach(() => {
    walletService = createMock<WalletService>();
    transactionService = createMock<TransactionService>();
    buyCryptoWebhookService = createMock<BuyCryptoWebhookService>();
    buyFiatService = createMock<BuyFiatService>();
    transactionService.getTransactionsForUsers.mockResolvedValue([]);

    service = new KycClientService(
      createMock<KycDocumentService>(),
      createMock<UserService>(),
      walletService,
      buyCryptoWebhookService,
      buyFiatService,
      transactionService,
    );
  });

  describe('getAllPayments', () => {
    it('throws ForbiddenException, logs, and loads no transactions when paymentsApiEnabled is false', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: false }));
      const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation();

      await expect(service.getAllPayments(7, dateFrom, dateTo)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.getAllPayments(7, dateFrom, dateTo)).rejects.toThrow(
        'Payments API not enabled for this wallet',
      );
      expect(transactionService.getTransactionsForUsers).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('Payments API denied for wallet 7');
    });

    it('returns payments when paymentsApiEnabled is true', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: true }));

      const result = await service.getAllPayments(7, dateFrom, dateTo, 100);

      expect(result).toEqual([]);
      expect(transactionService.getTransactionsForUsers).toHaveBeenCalledWith([42], dateFrom, dateTo, 100);
    });

    it('rejects a freshly created wallet (paymentsApiEnabled defaults to false / unset)', async () => {
      // Mirrors TypeORM entity construction before the column is set — fail-closed on !== true.
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: undefined }));

      await expect(service.getAllPayments(7, dateFrom, dateTo)).rejects.toBeInstanceOf(ForbiddenException);
      expect(transactionService.getTransactionsForUsers).not.toHaveBeenCalled();
    });

    it('includes every wallet user regardless of payment webhook consent (pre-gate row set)', async () => {
      // CONSENT_ONLY would admit only kycClientList users on the push path; pull must still list both.
      const consentedUser = userWith(10, '0xCONSENTED', '7');
      const plainUser = userWith(11, '0xPLAIN');
      walletService.getByIdOrName.mockResolvedValue(
        walletWith({
          paymentsApiEnabled: true,
          paymentOption: WebhookConfigOption.CONSENT_ONLY,
          users: [consentedUser, plainUser],
        }),
      );

      await service.getAllPayments(7, dateFrom, dateTo);

      expect(transactionService.getTransactionsForUsers).toHaveBeenCalledWith([10, 11], dateFrom, dateTo, undefined);
    });
  });

  describe('getAllUserPayments', () => {
    it('throws ForbiddenException and loads no transactions when paymentsApiEnabled is false', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: false }));

      await expect(service.getAllUserPayments(7, '0xUSER', dateFrom, dateTo)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.getAllUserPayments(7, '0xUSER', dateFrom, dateTo)).rejects.toThrow(
        'Payments API not enabled for this wallet',
      );
      expect(transactionService.getTransactionsForUsers).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException (403) for an unknown user address when the flag is off — gate before user lookup', async () => {
      // If assertPaymentsApiEnabled ran after users.find, a missing address would 404 instead of 403
      // and leak whether the address exists on a locked partner wallet.
      walletService.getByIdOrName.mockResolvedValue(
        walletWith({ paymentsApiEnabled: false, users: [userWith(42, '0xUSER')] }),
      );

      await expect(service.getAllUserPayments(7, '0xDOES_NOT_EXIST', dateFrom, dateTo)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.getAllUserPayments(7, '0xDOES_NOT_EXIST', dateFrom, dateTo)).rejects.toThrow(
        'Payments API not enabled for this wallet',
      );
      expect(transactionService.getTransactionsForUsers).not.toHaveBeenCalled();
    });

    it('returns user payments when paymentsApiEnabled is true', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: true }));

      const result = await service.getAllUserPayments(7, '0xUSER', dateFrom, dateTo);

      expect(result).toEqual([]);
      expect(transactionService.getTransactionsForUsers).toHaveBeenCalledWith([42], dateFrom, dateTo);
    });

    it('includes a user without payment consent (pre-gate row set)', async () => {
      const plainUser = userWith(11, '0xPLAIN');
      walletService.getByIdOrName.mockResolvedValue(
        walletWith({
          paymentsApiEnabled: true,
          paymentOption: WebhookConfigOption.CONSENT_ONLY,
          users: [plainUser],
        }),
      );

      await service.getAllUserPayments(7, '0xPLAIN', dateFrom, dateTo);

      expect(transactionService.getTransactionsForUsers).toHaveBeenCalledWith([11], dateFrom, dateTo);
    });
  });

  describe('partner pull response redaction', () => {
    /** Inject a full webhook-shaped payload; redaction under test is the pull-path strip only. */
    const seedFullPaymentDto = () => {
      jest.spyOn(service as any, 'toPaymentDtos').mockResolvedValue([fullPaymentPayload()]);
    };

    it('getAllPayments omits every field in PARTNER_PAYMENT_OMITTED_FIELDS', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: true }));
      seedFullPaymentDto();

      const [row] = await service.getAllPayments(7, dateFrom, dateTo);
      const keys = Object.keys(row);

      for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
        expect(keys).not.toContain(field);
        expect(row).not.toHaveProperty(field);
      }

      // Kept operational fields still present.
      expect(row.dfxReference).toBe(12345);
      expect(row.inputAmount).toBe(100);
      expect(row.outputAmount).toBe(90);
      expect(row.externalTransactionId).toBe('partner-ext-1');
      expect(row.chargebackAmount).toBe(5);
    });

    it('getAllUserPayments omits every field in PARTNER_PAYMENT_OMITTED_FIELDS', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: true }));
      seedFullPaymentDto();

      const [row] = await service.getAllUserPayments(7, '0xUSER', dateFrom, dateTo);
      const keys = Object.keys(row);

      for (const field of PARTNER_PAYMENT_OMITTED_FIELDS) {
        expect(keys).not.toContain(field);
        expect(row).not.toHaveProperty(field);
      }
    });

    it('walks the full payload keys: kept fields survive, omitted fields are gone', async () => {
      walletService.getByIdOrName.mockResolvedValue(walletWith({ paymentsApiEnabled: true }));
      seedFullPaymentDto();
      const full = fullPaymentPayload();
      const fullKeys = Object.keys(full);
      const omitted = new Set<string>(PARTNER_PAYMENT_OMITTED_FIELDS);

      const [row] = await service.getAllPayments(7, dateFrom, dateTo);
      const rowKeys = new Set(Object.keys(row));

      for (const key of fullKeys) {
        if (omitted.has(key)) {
          expect(rowKeys.has(key)).toBe(false);
        } else {
          expect(rowKeys.has(key)).toBe(true);
          expect((row as any)[key]).toEqual((full as any)[key]);
        }
      }
    });
  });
});
