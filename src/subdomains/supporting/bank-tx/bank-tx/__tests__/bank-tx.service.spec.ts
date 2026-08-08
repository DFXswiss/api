import { createMock } from '@golevelup/ts-jest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Subject } from 'rxjs';
import { ConfigService } from 'src/config/config';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { createCustomPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BankData } from 'src/subdomains/generic/user/models/bank-data/bank-data.entity';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { UserData } from 'src/subdomains/generic/user/models/user-data/user-data.entity';
import { User } from 'src/subdomains/generic/user/models/user/user.entity';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { IbanBankName } from 'src/subdomains/supporting/bank/bank/dto/bank.dto';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { MailContext, MailType } from 'src/subdomains/supporting/notification/enums';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import {
  TransactionSourceType,
  TransactionTypeInternal,
} from 'src/subdomains/supporting/payment/entities/transaction.entity';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionNotificationService } from 'src/subdomains/supporting/payment/services/transaction-notification.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOperator } from 'typeorm';
import { BankTxRepeatService } from '../../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../__mocks__/bank-tx.entity.mock';
import { UpdateBankTxDto } from '../dto/update-bank-tx.dto';
import { BankTx, BankTxIndicator, BankTxType, BankTxUnassignedTypes } from '../entities/bank-tx.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';
import { BankTxRepository } from '../repositories/bank-tx.repository';
import { BankTxFiatRepublicService } from '../services/bank-tx-fiat-republic.service';
import { BankTxFrickService } from '../services/bank-tx-frick.service';
import { BankTxService, TransactionBankTxTypeMapper } from '../services/bank-tx.service';
import { SepaParser } from '../services/sepa-parser.service';

// one raw aggregate row as returned by the GROUP BY currency, creditDebitIndicator query
interface FeeAggregate {
  currency: string;
  creditDebitIndicator: BankTxIndicator;
  amount: string; // Postgres returns SUM() as a string
}

// one raw aggregate row as returned by the source-3 GROUP BY chargeCurrency query (statement-inline charges)
interface InlineChargeAggregate {
  currency: string;
  amount: string; // Postgres returns SUM() as a string
}

describe('BankTxService', () => {
  let service: BankTxService;

  let bankTxRepo: BankTxRepository;
  let bankTxBatchRepo: BankTxBatchRepository;
  let bankService: BankService;
  let pricingService: PricingService;
  let fiatService: FiatService;
  let buyCryptoService: BuyCryptoService;
  let notificationService: NotificationService;
  let settingService: SettingService;
  let olkyService: OlkypayService;
  let frickTxService: BankTxFrickService;
  let fiatRepublicTxService: BankTxFiatRepublicService;
  let bankTxReturnService: BankTxReturnService;
  let bankTxRepeatService: BankTxRepeatService;
  let buyService: BuyService;
  let yapealService: YapealService;
  let transactionService: TransactionService;
  let specialAccountService: SpecialExternalAccountService;
  let sepaParser: SepaParser;
  let bankDataService: BankDataService;
  let virtualIbanService: VirtualIbanService;
  let transactionNotificationService: TransactionNotificationService;

  // onModuleInit subscribes to this stream, so it has to be a real one: an auto-mocked getter would
  // hand out a proxy whose subscribe() never calls back, and the subscription would look wired while
  // no bank data event ever reached the service.
  let bankDataSubject: Subject<BankData>;

  // getBankTxFee builds three query builders in order: (1) legacy chargeAmountChf sum (getRawOne),
  // (2) BankAccountFee per-currency/direction aggregation (getRawMany), (3) statement-inline charge
  // aggregation (getRawMany). Each source gets its own chainable mock so their terminal results are independent.
  let legacyQb: any;
  let feeAggQb: any;
  let inlineQb: any;

  const from = new Date('2026-07-01');

  // Distinct per-currency CHF prices. Price.convert divides the amount by the price
  // (getPrice(fiat, CHF).convert(x) = x / price), so a wrong currency->price mapping or an
  // inverted (multiply) direction produces a different total and turns these tests red.
  const chfPriceByCurrency: Record<string, number> = { EUR: 0.8, USD: 2 };

  beforeAll(() => {
    new ConfigService(); // sets module-level Config (defaultVolumeDecimal read by the CHF conversion)
  });

  beforeEach(() => {
    jest.clearAllMocks();

    bankTxRepo = createMock<BankTxRepository>();
    bankTxBatchRepo = createMock<BankTxBatchRepository>();
    bankService = createMock<BankService>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();
    buyCryptoService = createMock<BuyCryptoService>();
    notificationService = createMock<NotificationService>();
    settingService = createMock<SettingService>();
    olkyService = createMock<OlkypayService>();
    frickTxService = createMock<BankTxFrickService>();
    fiatRepublicTxService = createMock<BankTxFiatRepublicService>();
    bankTxReturnService = createMock<BankTxReturnService>();
    bankTxRepeatService = createMock<BankTxRepeatService>();
    buyService = createMock<BuyService>();
    yapealService = createMock<YapealService>();
    transactionService = createMock<TransactionService>();
    specialAccountService = createMock<SpecialExternalAccountService>();
    sepaParser = createMock<SepaParser>();
    bankDataService = createMock<BankDataService>();
    virtualIbanService = createMock<VirtualIbanService>();
    transactionNotificationService = createMock<TransactionNotificationService>();

    bankDataSubject = new Subject<BankData>();
    Object.defineProperty(bankDataService, 'bankDataObservable', {
      configurable: true,
      get: () => bankDataSubject.asObservable(),
    });

    // one chainable query builder mock per source; createQueryBuilder hands them out in call order
    legacyQb = chainableQb();
    feeAggQb = chainableQb();
    inlineQb = chainableQb();
    (bankTxRepo.createQueryBuilder as jest.Mock)
      .mockReturnValueOnce(legacyQb)
      .mockReturnValueOnce(feeAggQb)
      .mockReturnValueOnce(inlineQb);

    // sensible empty defaults so a test only sets the source it exercises
    legacyQb.getRawOne.mockResolvedValue({ fee: null });
    feeAggQb.getRawMany.mockResolvedValue([]);
    inlineQb.getRawMany.mockResolvedValue([]);

    (fiatService.getFiatByName as jest.Mock).mockImplementation((name: string) => createCustomFiat({ name }));

    service = new BankTxService(
      bankTxRepo,
      bankTxBatchRepo,
      buyCryptoService,
      notificationService,
      settingService,
      olkyService,
      frickTxService,
      fiatRepublicTxService,
      bankTxReturnService,
      bankTxRepeatService,
      buyService,
      bankService,
      yapealService,
      transactionService,
      specialAccountService,
      sepaParser,
      bankDataService,
      virtualIbanService,
      transactionNotificationService,
      pricingService,
      fiatService,
    );
  });

  function chainableQb(): any {
    const qb: any = {
      select: jest.fn(() => qb),
      addSelect: jest.fn(() => qb),
      where: jest.fn(() => qb),
      andWhere: jest.fn(() => qb),
      groupBy: jest.fn(() => qb),
      addGroupBy: jest.fn(() => qb),
      getRawOne: jest.fn(),
      getRawMany: jest.fn(),
    };
    return qb;
  }

  function mockLegacyFee(fee: number | null): void {
    legacyQb.getRawOne.mockResolvedValue({ fee });
  }

  function mockFeeAggregates(rows: FeeAggregate[]): void {
    feeAggQb.getRawMany.mockResolvedValue(rows);
  }

  function mockInlineCharges(rows: InlineChargeAggregate[]): void {
    inlineQb.getRawMany.mockResolvedValue(rows);
  }

  // per-currency prices from chfPriceByCurrency (distinct so mapping/direction errors are caught)
  function mockChfPrices(): void {
    (pricingService.getPrice as jest.Mock).mockImplementation(async (fiat: { name: string }) =>
      createCustomPrice({ source: fiat.name, target: 'CHF', price: chfPriceByCurrency[fiat.name] }),
    );
  }

  it('converts each DBIT currency aggregate with its own price and sums the result', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([
      { currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' },
      { currency: 'USD', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '200' },
    ]);
    mockChfPrices();

    // EUR 100 / 0.8 = 125 CHF; USD 200 / 2 = 100 CHF; total 225 CHF
    // (a multiply direction -> 80 + 400 = 480; a swapped currency->price -> 125 + 250 = 375)
    await expect(service.getBankTxFee(from)).resolves.toBe(225);

    expect(fiatService.getFiatByName).toHaveBeenCalledWith('EUR');
    expect(fiatService.getFiatByName).toHaveBeenCalledWith('USD');
    expect(pricingService.getPrice).toHaveBeenCalledTimes(2);
  });

  it('nets a CRDT refund against a DBIT fee in the same currency before converting', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([
      { currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' },
      { currency: 'EUR', creditDebitIndicator: BankTxIndicator.CREDIT, amount: '30' },
    ]);
    mockChfPrices();

    // net EUR 70 / 0.8 = 87.5 CHF (converted once, after netting)
    await expect(service.getBankTxFee(from)).resolves.toBe(87.5);

    expect(pricingService.getPrice).toHaveBeenCalledTimes(1);
  });

  it('adds the legacy chargeAmountChf sum on top of the converted BankAccountFee aggregates', async () => {
    mockLegacyFee(5);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' }]);
    mockChfPrices();

    // legacy 5 + EUR 100 / 0.8 (125) = 130
    await expect(service.getBankTxFee(from)).resolves.toBe(130);
  });

  it('rounds the assembled total to the default volume decimals', async () => {
    mockLegacyFee(0.1);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '0.2' }]);
    // price 1 so the converted amount is exactly 0.2 and only the final sum needs rounding
    (pricingService.getPrice as jest.Mock).mockResolvedValue(
      createCustomPrice({ source: 'EUR', target: 'CHF', price: 1 }),
    );

    // legacy 0.1 + EUR 0.2 = 0.30000000000000004 in float -> must be rounded to 0.3
    await expect(service.getBankTxFee(from)).resolves.toBe(0.3);
  });

  it('fails loud when the price is unavailable', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' }]);
    (pricingService.getPrice as jest.Mock).mockRejectedValue(new Error('No valid price'));

    await expect(service.getBankTxFee(from)).rejects.toThrow();
  });

  it('returns only the legacy sum when there are no BankAccountFee aggregates', async () => {
    mockLegacyFee(5);
    mockFeeAggregates([]);

    await expect(service.getBankTxFee(from)).resolves.toBe(5);

    expect(pricingService.getPrice).not.toHaveBeenCalled();
  });

  it('includes a statement-inline charge (source 3) and converts it to CHF via its currency price', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([]);
    mockInlineCharges([{ currency: 'EUR', amount: '80' }]);
    mockChfPrices();

    // EUR 80 / 0.8 = 100 CHF; a charge is a positive cost added as-is (no credit/debit sign logic for source 3)
    await expect(service.getBankTxFee(from)).resolves.toBe(100);

    expect(fiatService.getFiatByName).toHaveBeenCalledWith('EUR');
    expect(pricingService.getPrice).toHaveBeenCalledTimes(1);
  });

  it('scopes source 3 so charged-CHF and BankAccountFee rows cannot be double-counted', async () => {
    // The anti-double-count guarantee lives in the source-3 WHERE clause (the mocked builder runs no SQL), so we
    // assert the query is constructed with exactly those filters.
    mockLegacyFee(10);
    mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' }]);
    mockInlineCharges([]);
    mockChfPrices();

    await service.getBankTxFee(from);

    // (a) rows that already carry chargeAmountChf stay in source 1 only — source 3 excludes non-null chargeAmountChf
    expect(inlineQb.andWhere).toHaveBeenCalledWith('bankTx.chargeAmountChf IS NULL');
    // (b) BankAccountFee rows stay in source 2 only — the IS NULL OR guard both excludes them and keeps the
    //     type=null inline charges (a bare `!= :feeType` would drop them under Postgres NULL semantics)
    expect(inlineQb.andWhere).toHaveBeenCalledWith('(bankTx.type IS NULL OR bankTx.type != :feeType)', {
      feeType: BankTxType.BANK_ACCOUNT_FEE,
    });
    // only non-zero charges from the same window are aggregated
    expect(inlineQb.where).toHaveBeenCalledWith('bankTx.chargeAmount != 0');
    expect(inlineQb.andWhere).toHaveBeenCalledWith('bankTx.created >= :from', { from });
  });

  it('fails loud when the price for a statement-inline charge currency is unavailable', async () => {
    mockLegacyFee(null);
    mockFeeAggregates([]);
    mockInlineCharges([{ currency: 'EUR', amount: '80' }]);
    (pricingService.getPrice as jest.Mock).mockRejectedValue(new Error('No valid price'));

    await expect(service.getBankTxFee(from)).rejects.toThrow();
  });

  describe('#getTrackedInternalTransfers(...)', () => {
    it('loads the immutable tracking set without expiring old pending transfers', async () => {
      const historical = createCustomBankTx({
        created: new Date('2024-09-04T09:04:02.150Z'),
        type: BankTxType.INTERNAL,
        isInternalTransfer: true,
      });
      (bankTxRepo.findBy as jest.Mock).mockResolvedValue([historical]);
      const recoveryQuery = jest.fn().mockResolvedValue([]);
      Object.defineProperty(bankTxRepo, 'manager', {
        configurable: true,
        value: { query: recoveryQuery },
      });

      await expect(service.getTrackedInternalTransfers()).resolves.toEqual([historical]);

      const recoverySql = recoveryQuery.mock.calls[0][0] as string;
      expect(recoverySql).toContain("l.subsystem = 'InternalBankTransferTrackingBackfill'");
      expect(recoverySql).toContain('bt."isInternalTransfer" IS NULL');
      expect(recoverySql).toContain('bt.created >= c."trackingCutover"');
      expect(recoverySql).toContain('bt.updated >= c."trackingCutover"');
      expect(recoverySql).toContain('bt.created >= c."trackingCutover" - INTERVAL \'21 days\'');
      expect(recoverySql).toContain('FROM bank source_bank');
      expect(recoverySql).toContain('FROM bank target_bank');
      expect(recoverySql.match(/\[\^A-Za-z0-9\]/g)).toHaveLength(4);
      expect(recoverySql).toContain("'InternalBankTransferRollingRecovery'");
      expect(recoverySql).toContain("'previousIsInternalTransfer', NULL");
      expect(recoverySql.indexOf('INSERT INTO "log"')).toBeLessThan(recoverySql.indexOf('UPDATE "bank_tx"'));
      expect(bankTxRepo.findBy).toHaveBeenCalledWith({
        type: BankTxType.INTERNAL,
        isInternalTransfer: true,
      });
      expect(bankService.getAllBanks).not.toHaveBeenCalled();
    });
  });

  describe('#create(...)', () => {
    it('persists the ownership marker when both transfer IBANs are configured DFX accounts', async () => {
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(true);
      (bankTxRepo.findOneBy as jest.Mock).mockResolvedValue(undefined);
      (bankTxRepo.create as jest.Mock).mockImplementation((values) => Object.assign(new BankTx(), values));
      (bankTxRepo.save as jest.Mock).mockImplementation(async (values) => values);

      await service.create({ accountServiceRef: 'INTERNAL-1', accountIban: 'OLKY-IBAN', iban: 'FRICK-IBAN' }, []);

      expect(bankTxRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ type: BankTxType.INTERNAL, isInternalTransfer: true }),
      );
    });
  });

  describe('#updateInternal(...)', () => {
    it('records a negative ownership decision for a newly reviewed external transfer', async () => {
      const bankTx = createCustomBankTx({
        type: BankTxType.INTERNAL,
        isInternalTransfer: null,
        accountIban: 'OLKY-IBAN',
        iban: 'EXTERNAL-IBAN',
      });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(false);

      await service.updateInternal(bankTx, { type: BankTxType.INTERNAL });

      expect(bankTx.isInternalTransfer).toBe(false);
      expect(bankService.areKnownBankIbans).toHaveBeenCalledWith('OLKY-IBAN', 'EXTERNAL-IBAN');
    });

    it('never revokes an immutable ownership marker after bank configuration changes', async () => {
      const bankTx = createCustomBankTx({
        type: BankTxType.INTERNAL,
        isInternalTransfer: true,
        accountIban: 'RETIRED-OLKY-IBAN',
        iban: 'FRICK-IBAN',
      });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(false);

      await service.updateInternal(bankTx, { type: BankTxType.INTERNAL });

      expect(bankTx.isInternalTransfer).toBe(true);
      expect(bankService.areKnownBankIbans).not.toHaveBeenCalled();
    });
  });

  describe('#getType(...)', () => {
    it('classifies a transfer between two configured bank IBANs as internal', async () => {
      const bankTx = createCustomBankTx({ accountIban: 'OLKY-IBAN', iban: 'FRICK-IBAN' });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(true);

      await expect(service.getType(bankTx)).resolves.toBe(BankTxType.INTERNAL);
      expect(bankService.areKnownBankIbans).toHaveBeenCalledWith('OLKY-IBAN', 'FRICK-IBAN');
    });

    it('keeps the existing counterparty classification for external transfers', async () => {
      const bankTx = createCustomBankTx({ accountIban: 'DFX-IBAN', iban: 'EXTERNAL-IBAN', name: 'Payward Trading' });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(false);

      await expect(service.getType(bankTx)).resolves.toBe(BankTxType.KRAKEN);
    });
  });

  describe('#classifyKnownTypeIfAssignable(...)', () => {
    it('does not overwrite a type assigned after the initial unassigned read', async () => {
      const staleBankTx = createCustomBankTx({ id: 208765, type: null, transaction: { id: 77 } as never });
      const currentBankTx = createCustomBankTx({
        id: 208765,
        type: BankTxType.BUY_FIAT,
        transactionId: 77,
      });
      const manager = { findOne: jest.fn().mockResolvedValue(currentBankTx), update: jest.fn() };
      Object.defineProperty(bankTxRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (callback: (entityManager: typeof manager) => Promise<void>) => callback(manager)),
        },
      });

      await expect(service.classifyKnownTypeIfAssignable(staleBankTx)).resolves.toBeUndefined();

      expect(manager.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ where: { id: 208765 }, lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('does not assign internal after the locked transfer IBAN was corrected to an external IBAN', async () => {
      const staleBankTx = createCustomBankTx({
        id: 208765,
        type: null,
        accountIban: 'OLKY-IBAN',
        iban: 'FRICK-IBAN',
        transaction: { id: 77 } as never,
      });
      const currentBankTx = createCustomBankTx({
        id: 208765,
        type: null,
        accountIban: 'OLKY-IBAN',
        iban: 'EXTERNAL-IBAN',
        transactionId: 77,
      });
      const manager = { findOne: jest.fn().mockResolvedValue(currentBankTx), update: jest.fn() };
      Object.defineProperty(bankTxRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (callback: (entityManager: typeof manager) => Promise<void>) => callback(manager)),
        },
      });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(false);

      await expect(service.classifyKnownTypeIfAssignable(staleBankTx)).resolves.toBe(currentBankTx);

      expect(bankService.areKnownBankIbans).toHaveBeenCalledWith('OLKY-IBAN', 'EXTERNAL-IBAN');
      expect(manager.findOne).toHaveBeenCalledTimes(1);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('locks both records and assigns the internal type atomically', async () => {
      const staleBankTx = createCustomBankTx({ id: 208765, type: null, transaction: { id: 77 } as never });
      const currentBankTx = createCustomBankTx({ id: 208765, type: null, transactionId: 77 });
      const currentTransaction = { id: 77, type: null };
      const manager = {
        findOne: jest.fn().mockResolvedValueOnce(currentBankTx).mockResolvedValueOnce(currentTransaction),
        update: jest.fn(),
      };
      Object.defineProperty(bankTxRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (callback: (entityManager: typeof manager) => Promise<void>) => callback(manager)),
        },
      });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(true);

      await expect(service.classifyKnownTypeIfAssignable(staleBankTx)).resolves.toEqual(
        expect.objectContaining({ id: 208765, type: BankTxType.INTERNAL }),
      );

      expect(manager.findOne).toHaveBeenCalledTimes(2);
      expect(manager.findOne).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ where: { id: 208765 }, lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.findOne).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({ where: { id: 77 }, lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.update).toHaveBeenCalledTimes(2);
    });

    it('atomically replaces a retryable GSheet classification', async () => {
      const bankTx = createCustomBankTx({ id: 208765, type: BankTxType.GSHEET, transaction: { id: 77 } as never });
      const currentBankTx = createCustomBankTx({ id: 208765, type: BankTxType.GSHEET, transactionId: 77 });
      const manager = {
        findOne: jest.fn().mockResolvedValueOnce(currentBankTx).mockResolvedValueOnce({ id: 77, type: undefined }),
        update: jest.fn(),
      };
      Object.defineProperty(bankTxRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (callback: (entityManager: typeof manager) => Promise<boolean>) =>
            callback(manager),
          ),
        },
      });
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(true);

      await expect(service.classifyKnownTypeIfAssignable(bankTx)).resolves.toEqual(
        expect.objectContaining({ id: 208765, type: BankTxType.INTERNAL }),
      );

      expect(manager.update).toHaveBeenNthCalledWith(1, expect.anything(), 77, { type: 'Internal' });
      expect(manager.update).toHaveBeenNthCalledWith(2, expect.anything(), 208765, {
        type: BankTxType.INTERNAL,
        isInternalTransfer: true,
      });
    });

    // The locked reads are what the whole method exists for, so each of their outcomes gets a case.
    function lockedManager(...found: unknown[]): { findOne: jest.Mock; update: jest.Mock } {
      const manager = { findOne: jest.fn(), update: jest.fn() };
      found.forEach((row) => manager.findOne.mockResolvedValueOnce(row));

      Object.defineProperty(bankTxRepo, 'manager', {
        configurable: true,
        value: {
          transaction: jest.fn(async (callback: (entityManager: typeof manager) => Promise<unknown>) =>
            callback(manager),
          ),
        },
      });

      return manager;
    }

    it('assigns nothing when the row disappeared before the lock', async () => {
      const manager = lockedManager(undefined);

      await expect(service.classifyKnownTypeIfAssignable(createCustomBankTx({ id: 208765 }))).resolves.toBeUndefined();

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('assigns nothing while the row has no transaction to classify along with it', async () => {
      const manager = lockedManager(createCustomBankTx({ id: 208765, type: null, transactionId: null }));

      await expect(service.classifyKnownTypeIfAssignable(createCustomBankTx({ id: 208765 }))).resolves.toBeUndefined();

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('does not hand back an unclassifiable row that already carries a final type', async () => {
      const manager = lockedManager(createCustomBankTx({ id: 208765, type: BankTxType.BUY_FIAT, transactionId: 77 }));
      jest.spyOn(service, 'getType').mockResolvedValue(null);

      await expect(service.classifyKnownTypeIfAssignable(createCustomBankTx({ id: 208765 }))).resolves.toBeUndefined();

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('never overwrites a transaction that was already classified as something else', async () => {
      const manager = lockedManager(createCustomBankTx({ id: 208765, type: null, transactionId: 77 }), {
        id: 77,
        type: TransactionTypeInternal.BUY_CRYPTO,
      });
      jest.spyOn(service, 'getType').mockResolvedValue(BankTxType.KRAKEN);

      await expect(service.classifyKnownTypeIfAssignable(createCustomBankTx({ id: 208765 }))).resolves.toBeUndefined();

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('writes nothing when the locked state already matches the detected classification', async () => {
      const currentBankTx = createCustomBankTx({
        id: 208765,
        type: BankTxType.KRAKEN,
        isInternalTransfer: false,
        transactionId: 77,
      });
      const currentTransaction = { id: 77, type: TransactionTypeInternal.KRAKEN };
      const manager = lockedManager(currentBankTx, currentTransaction);
      jest.spyOn(service, 'getType').mockResolvedValue(BankTxType.KRAKEN);

      await expect(service.classifyKnownTypeIfAssignable(createCustomBankTx({ id: 208765 }))).resolves.toEqual(
        expect.objectContaining({
          type: BankTxType.KRAKEN,
          isInternalTransfer: false,
          transaction: currentTransaction,
        }),
      );

      expect(manager.update).not.toHaveBeenCalled();
    });

    it('adds the missing ownership marker to a row that was already typed internal', async () => {
      const currentBankTx = createCustomBankTx({
        id: 208765,
        type: BankTxType.INTERNAL,
        isInternalTransfer: null,
        transactionId: 77,
      });
      const manager = lockedManager(currentBankTx, { id: 77, type: TransactionTypeInternal.INTERNAL });
      jest.spyOn(service, 'getType').mockResolvedValue(BankTxType.INTERNAL);

      await expect(service.classifyKnownTypeIfAssignable(createCustomBankTx({ id: 208765 }))).resolves.toEqual(
        expect.objectContaining({ isInternalTransfer: true }),
      );

      // only the bank tx is written: the transaction already carries the right type
      expect(manager.update).toHaveBeenCalledTimes(1);
      expect(manager.update).toHaveBeenCalledWith(expect.anything(), 208765, {
        type: BankTxType.INTERNAL,
        isInternalTransfer: true,
      });
    });
  });

  // Lets the promise chain of a fire-and-forget subscription callback settle.
  function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
  }

  // getBankTxFee hands out three query builders from the queued mocks above; the query-building
  // getters need their own, so the queue is cleared first.
  function useSingleQueryBuilder(): Record<string, jest.Mock> {
    const qb: Record<string, jest.Mock> = {
      select: jest.fn(() => qb),
      leftJoinAndSelect: jest.fn(() => qb),
      where: jest.fn(() => qb),
      getOne: jest.fn(),
    } as never;
    (bankTxRepo.createQueryBuilder as jest.Mock).mockReset().mockReturnValue(qb);
    return qb;
  }

  describe('#onModuleInit()', () => {
    it('assigns and notifies the account as soon as a bank data record verifies its IBAN', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      const transaction = { id: 9, userData: null } as never;
      const bankTx = createCustomBankTx({ id: 1, transaction });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([bankTx]);

      service.onModuleInit();
      bankDataSubject.next({ iban: 'DE12500105170648489890', userData } as BankData);
      await flush();

      expect(transactionService.updateInternal).toHaveBeenCalledWith(transaction, { userData });
      expect(transactionNotificationService.sendUnassignedTxMail).toHaveBeenCalledWith(transaction, userData);
    });
  });

  describe('#checkBankTx()', () => {
    // Every rail is imported from the same job, so an outage on one must not keep the others from
    // running - and the assign/fill steps after them have to run either way.
    beforeEach(() => {
      (settingService.get as jest.Mock).mockResolvedValue(new Date(0).toISOString());
      (bankService.getBankInternal as jest.Mock).mockResolvedValue({ iban: 'OLKY-IBAN' });
      (olkyService.getOlkyTransactions as jest.Mock).mockResolvedValue([]);
      (specialAccountService.getMultiAccounts as jest.Mock).mockResolvedValue([]);
      (bankTxRepo.find as jest.Mock).mockResolvedValue([]);
    });

    it('imports from all three rails and then assigns and fills', async () => {
      await service.checkBankTx();

      expect(olkyService.getOlkyTransactions).toHaveBeenCalledWith(new Date(0).toISOString(), 'OLKY-IBAN');
      expect(frickTxService.checkTransactions).toHaveBeenCalledWith(expect.any(Function));
      expect(fiatRepublicTxService.checkTransactions).toHaveBeenCalledWith(expect.any(Function), []);
      // assignTransactions and fillBankTx each read their own work list
      expect(bankTxRepo.find).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['Olky', () => (olkyService.getOlkyTransactions as jest.Mock).mockRejectedValue(new Error('olky down'))],
      ['Bank Frick', () => (frickTxService.checkTransactions as jest.Mock).mockRejectedValue(new Error('frick down'))],
      [
        'Fiat Republic',
        () => (fiatRepublicTxService.checkTransactions as jest.Mock).mockRejectedValue(new Error('fr down')),
      ],
    ])('keeps importing the other rails when %s fails', async (_rail, breakRail) => {
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();
      breakRail();

      await expect(service.checkBankTx()).resolves.toBeUndefined();

      expect(error).toHaveBeenCalledTimes(1);
      expect(frickTxService.checkTransactions).toHaveBeenCalled();
      expect(fiatRepublicTxService.checkTransactions).toHaveBeenCalled();
      expect(bankTxRepo.find).toHaveBeenCalledTimes(2);
    });
  });

  describe('#enrichYapealTransactions()', () => {
    it('does not call the bank when there is nothing to enrich', async () => {
      (bankTxRepo.find as jest.Mock).mockResolvedValue([]);

      await service.enrichYapealTransactions();

      expect(yapealService.getTransactions).not.toHaveBeenCalled();
    });

    it('spans the window from the oldest to the day after the newest booking and enriches by service ref', async () => {
      const booked = createCustomBankTx({
        id: 1,
        accountIban: 'CH-YAPEAL',
        accountServiceRef: 'REF-1',
        bookingDate: new Date('2026-07-01'),
      });
      // no bookingDate: the credit-card rows this job exists for can arrive without one, and the
      // window then has to fall back to the creation date instead of an invalid date
      const unbooked = createCustomBankTx({
        id: 2,
        accountIban: 'CH-YAPEAL',
        accountServiceRef: 'REF-2',
        bookingDate: null,
        created: new Date('2026-07-03'),
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([booked, unbooked]);
      (yapealService.getTransactions as jest.Mock).mockResolvedValue([
        {
          accountServiceRef: 'REF-1',
          addressLine1: 'Street 1',
          addressLine2: null,
          country: 'CH',
          domainCode: 'PMNT',
          familyCode: 'CCRD',
          subFamilyCode: 'POSD',
        },
      ]);

      await service.enrichYapealTransactions();

      expect(yapealService.getTransactions).toHaveBeenCalledWith(
        'CH-YAPEAL',
        new Date('2026-07-01'),
        new Date('2026-07-04'),
      );
      // null fields are dropped so an enrichment never overwrites existing data with nothing
      expect(bankTxRepo.update).toHaveBeenCalledTimes(1);
      expect(bankTxRepo.update).toHaveBeenCalledWith(1, {
        addressLine1: 'Street 1',
        country: 'CH',
        domainCode: 'PMNT',
        familyCode: 'CCRD',
        subFamilyCode: 'POSD',
      });
    });

    it('continues with the next account when one account cannot be read', async () => {
      const failing = createCustomBankTx({ id: 1, accountIban: 'CH-FAILING', bookingDate: new Date('2026-07-01') });
      const working = createCustomBankTx({
        id: 2,
        accountIban: 'CH-WORKING',
        accountServiceRef: 'REF-2',
        bookingDate: new Date('2026-07-01'),
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([failing, working]);
      (yapealService.getTransactions as jest.Mock)
        .mockRejectedValueOnce(new Error('yapeal down'))
        .mockResolvedValueOnce([{ accountServiceRef: 'REF-2', country: 'CH' }]);
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();

      await service.enrichYapealTransactions();

      expect(warn).toHaveBeenCalledTimes(1);
      expect(bankTxRepo.update).toHaveBeenCalledWith(2, { country: 'CH' });
    });
  });

  describe('#checkTransactions()', () => {
    it('warns once while the Olky bank is not configured and imports nothing', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation();
      (settingService.get as jest.Mock).mockResolvedValue(new Date(0).toISOString());
      (bankService.getBankInternal as jest.Mock).mockResolvedValue(undefined);

      await service['checkTransactions']();
      await service['checkTransactions']();

      expect(bankService.getBankInternal).toHaveBeenCalledWith(IbanBankName.OLKY, 'EUR');
      expect(olkyService.getOlkyTransactions).not.toHaveBeenCalled();
      // the second run stays silent: this runs every 30 seconds, so a repeated warning would flood the log
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('advances the watermark once the batch was imported, and logs only unexpected failures', async () => {
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();
      (settingService.get as jest.Mock).mockResolvedValue('2026-07-01T00:00:00.000Z');
      (bankService.getBankInternal as jest.Mock).mockResolvedValue({ iban: 'OLKY-IBAN' });
      (olkyService.getOlkyTransactions as jest.Mock).mockResolvedValue([
        { accountServiceRef: 'A' },
        { accountServiceRef: 'B' },
      ]);
      (specialAccountService.getMultiAccounts as jest.Mock).mockResolvedValue([]);
      jest
        .spyOn(service, 'create')
        .mockRejectedValueOnce(new ConflictException('already imported'))
        .mockRejectedValueOnce(new Error('unexpected'));

      await service['checkTransactions']();

      // a duplicate is the normal case for an overlapping window and must not be logged as an error
      expect(error).toHaveBeenCalledTimes(1);
      expect(settingService.set).toHaveBeenCalledWith('lastBankOlkyDate', expect.any(String));
    });

    it('leaves the watermark alone when the window returned nothing', async () => {
      (settingService.get as jest.Mock).mockResolvedValue('2026-07-01T00:00:00.000Z');
      (bankService.getBankInternal as jest.Mock).mockResolvedValue({ iban: 'OLKY-IBAN' });
      (olkyService.getOlkyTransactions as jest.Mock).mockResolvedValue([]);
      (specialAccountService.getMultiAccounts as jest.Mock).mockResolvedValue([]);

      await service['checkTransactions']();

      expect(settingService.set).not.toHaveBeenCalled();
    });
  });

  describe('#assignTransactions()', () => {
    beforeEach(() => {
      // an auto-mocked existsBy returns a truthy proxy, which would silently skip every assignment
      (bankTxRepo.existsBy as jest.Mock).mockResolvedValue(false);
      (specialAccountService.getMultiAccounts as jest.Mock).mockResolvedValue([]);
    });

    it('does nothing while there is no unassigned transaction', async () => {
      (bankTxRepo.find as jest.Mock).mockResolvedValue([]);

      await service['assignTransactions']();

      expect(buyService.getAllBankUsages).not.toHaveBeenCalled();
    });

    it('does not load the buy usages for a debit-only work list', async () => {
      const debit = createCustomBankTx({ id: 1, creditDebitIndicator: BankTxIndicator.DEBIT });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([debit]);
      jest.spyOn(service, 'getType').mockResolvedValue(null);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(debit);

      await service['assignTransactions']();

      expect(buyService.getAllBankUsages).not.toHaveBeenCalled();
      // an unclassifiable row goes to the manual sheet rather than staying invisible
      expect(updateInternal).toHaveBeenCalledWith(debit, { type: BankTxType.GSHEET });
    });

    it('hands an internal transfer to the locking classification and assigns nothing else', async () => {
      const internal = createCustomBankTx({ id: 1, creditDebitIndicator: BankTxIndicator.DEBIT });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([internal]);
      jest.spyOn(service, 'getType').mockResolvedValue(BankTxType.INTERNAL);
      const classify = jest.spyOn(service, 'classifyKnownTypeIfAssignable').mockResolvedValue(internal);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(internal);

      await service['assignTransactions']();

      expect(classify).toHaveBeenCalledWith(internal);
      expect(updateInternal).not.toHaveBeenCalled();
    });

    it('prefers the dedicated asset vIBAN over the remittance info', async () => {
      const credit = createCustomBankTx({
        id: 1,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        virtualIban: 'CH-VIBAN',
        remittanceInfo: 'ABC-123',
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([credit]);
      (buyService.getAllBankUsages as jest.Mock).mockResolvedValue([{ id: 99, bankUsage: 'ABC-123' }]);
      (virtualIbanService.getByIban as jest.Mock).mockResolvedValue({ buy: { id: 42 } });
      jest.spyOn(service, 'getType').mockResolvedValue(null);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(credit);

      await service['assignTransactions']();

      expect(updateInternal).toHaveBeenCalledWith(credit, { type: BankTxType.BUY_CRYPTO, buyId: 42 });
    });

    it('falls back to the remittance info when the vIBAN carries no buy route', async () => {
      const credit = createCustomBankTx({
        id: 1,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        virtualIban: 'CH-VIBAN',
        remittanceInfo: 'ABC-123',
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([credit]);
      (buyService.getAllBankUsages as jest.Mock).mockResolvedValue([{ id: 99, bankUsage: 'ABC-123' }]);
      (virtualIbanService.getByIban as jest.Mock).mockResolvedValue(undefined);
      jest.spyOn(service, 'getType').mockResolvedValue(null);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(credit);

      await service['assignTransactions']();

      expect(updateInternal).toHaveBeenCalledWith(credit, { type: BankTxType.BUY_CRYPTO, buyId: 99 });
    });

    it('leaves a row alone that was classified between the read and the write', async () => {
      const credit = createCustomBankTx({ id: 1, creditDebitIndicator: BankTxIndicator.CREDIT, remittanceInfo: '-' });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([credit]);
      (buyService.getAllBankUsages as jest.Mock).mockResolvedValue([]);
      (bankTxRepo.existsBy as jest.Mock).mockResolvedValue(true);
      jest.spyOn(service, 'getType').mockResolvedValue(null);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(credit);

      await service['assignTransactions']();

      expect(bankTxRepo.existsBy).toHaveBeenCalledWith({ id: 1, type: expect.anything() });
      expect(updateInternal).not.toHaveBeenCalled();
    });

    it('continues with the next row when one assignment fails', async () => {
      const failing = createCustomBankTx({ id: 1, creditDebitIndicator: BankTxIndicator.DEBIT });
      const working = createCustomBankTx({ id: 2, creditDebitIndicator: BankTxIndicator.DEBIT });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([failing, working]);
      jest.spyOn(service, 'getType').mockRejectedValueOnce(new Error('classification failed')).mockResolvedValue(null);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(working);
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['assignTransactions']();

      expect(error).toHaveBeenCalledTimes(1);
      expect(updateInternal).toHaveBeenCalledWith(working, { type: BankTxType.GSHEET });
    });
  });

  describe('#fillBankTx()', () => {
    it('derives the buy-crypto fee split from the order and rounds every stored value', async () => {
      const tx = createCustomBankTx({
        id: 1,
        type: BankTxType.BUY_CRYPTO,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        amount: 1000,
        chargeAmount: 0,
        buyCrypto: { percentFee: 0.01, amountInChf: 900 } as never,
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([tx]);

      await service['fillBankTx']();

      expect(bankTxRepo.update).toHaveBeenCalledWith(1, {
        accountingAmountBeforeFee: 1000,
        accountingFeePercent: 0.01,
        accountingFeeAmount: 10,
        accountingAmountAfterFee: 990,
        accountingAmountBeforeFeeChf: 900,
        accountingAmountAfterFeeChf: 891,
      });
    });

    it('waits for the order of a buy row instead of booking an incomplete split', async () => {
      const tx = createCustomBankTx({
        id: 1,
        type: BankTxType.BUY_CRYPTO,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        amount: 1000,
        chargeAmount: 0,
        buyCrypto: null,
        buyFiats: [],
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([tx]);

      await service['fillBankTx']();

      expect(bankTxRepo.update).not.toHaveBeenCalled();
    });

    it('continues with the next row when one row cannot be written', async () => {
      const failing = createCustomBankTx({
        id: 1,
        type: BankTxType.FIAT_FIAT,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        amount: 100,
        chargeAmount: 0,
      });
      const working = createCustomBankTx({
        id: 2,
        type: BankTxType.FIAT_FIAT,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        amount: 200,
        chargeAmount: 0,
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([failing, working]);
      (bankTxRepo.update as jest.Mock).mockRejectedValueOnce(new Error('write failed'));
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();

      await service['fillBankTx']();

      expect(error).toHaveBeenCalledTimes(1);
      expect(bankTxRepo.update).toHaveBeenCalledWith(2, { accountingAmountBeforeFee: 200 });
    });
  });

  describe('#create(...)', () => {
    it('refuses to import the same bank reference twice', async () => {
      (bankTxRepo.findOneBy as jest.Mock).mockResolvedValue(createCustomBankTx({ id: 1 }));

      await expect(service.create({ accountServiceRef: 'REF-1' }, [])).rejects.toThrow(ConflictException);

      expect(bankTxRepo.save).not.toHaveBeenCalled();
    });

    it('opens the transaction with the type mapped from the detected bank tx type', async () => {
      (bankTxRepo.findOneBy as jest.Mock).mockResolvedValue(undefined);
      (bankTxRepo.create as jest.Mock).mockImplementation((values) => Object.assign(new BankTx(), values));
      (bankTxRepo.save as jest.Mock).mockImplementation(async (values) => values);
      jest.spyOn(service, 'getType').mockResolvedValue(BankTxType.KRAKEN);

      await service.create({ accountServiceRef: 'REF-1' }, []);

      expect(transactionService.create).toHaveBeenCalledWith({
        sourceType: TransactionSourceType.BANK_TX,
        type: TransactionTypeInternal.KRAKEN,
      });
    });

    it('opens the transaction without a type for a bank tx type that has none', async () => {
      (bankTxRepo.findOneBy as jest.Mock).mockResolvedValue(undefined);
      (bankTxRepo.create as jest.Mock).mockImplementation((values) => Object.assign(new BankTx(), values));
      (bankTxRepo.save as jest.Mock).mockImplementation(async (values) => values);
      jest.spyOn(service, 'getType').mockResolvedValue(BankTxType.GSHEET);

      await service.create({ accountServiceRef: 'REF-1' }, []);

      expect(TransactionBankTxTypeMapper[BankTxType.GSHEET]).toBeNull();
      expect(transactionService.create).toHaveBeenCalledWith({
        sourceType: TransactionSourceType.BANK_TX,
        type: undefined,
      });
    });
  });

  describe('#update(...)', () => {
    it('fails loud for an unknown id', async () => {
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(undefined);

      // `type` is declared non-optional on the DTO but validated as optional, so a request body
      // without it is what actually arrives here
      await expect(service.update(1, {} as UpdateBankTxDto)).rejects.toThrow(NotFoundException);
    });

    it('loads the chargeback relations the type change needs and delegates', async () => {
      const bankTx = createCustomBankTx({ id: 1 });
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(bankTx);
      const updateInternal = jest.spyOn(service, 'updateInternal').mockResolvedValue(bankTx);

      await service.update(1, { type: BankTxType.FIAT_FIAT });

      expect(bankTxRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          relations: expect.objectContaining({ buyFiats: { transaction: { user: { userData: true } } } }),
        }),
      );
      expect(updateInternal).toHaveBeenCalledWith(bankTx, { type: BankTxType.FIAT_FIAT });
    });
  });

  describe('#updateInternal(...)', () => {
    beforeEach(() => {
      (bankTxRepo.save as jest.Mock).mockImplementation(async (values) => values);
    });

    it('keeps an already completed classification', async () => {
      const bankTx = createCustomBankTx({ id: 1, type: BankTxType.BUY_CRYPTO });

      await expect(service.updateInternal(bankTx, { type: BankTxType.BUY_FIAT })).rejects.toThrow(ConflictException);

      expect(bankTxRepo.save).not.toHaveBeenCalled();
    });

    it('refuses to turn an outgoing payment into a buy', async () => {
      const bankTx = createCustomBankTx({ id: 1, type: null, creditDebitIndicator: BankTxIndicator.DEBIT });

      await expect(service.updateInternal(bankTx, { type: BankTxType.BUY_CRYPTO })).rejects.toThrow(
        BadRequestException,
      );

      expect(buyCryptoService.createFromBankTx).not.toHaveBeenCalled();
    });

    it('creates the buy order for an incoming payment', async () => {
      const bankTx = createCustomBankTx({ id: 1, type: null, creditDebitIndicator: BankTxIndicator.CREDIT });

      await service.updateInternal(bankTx, { type: BankTxType.BUY_CRYPTO, buyId: 42 });

      expect(buyCryptoService.createFromBankTx).toHaveBeenCalledWith(bankTx, 42);
    });

    it('attaches the created return to the row', async () => {
      const bankTx = createCustomBankTx({ id: 1, type: null, creditDebitIndicator: BankTxIndicator.CREDIT });
      const bankTxReturn = { id: 7 } as never;
      (bankTxReturnService.create as jest.Mock).mockResolvedValue(bankTxReturn);

      await service.updateInternal(bankTx, { type: BankTxType.BANK_TX_RETURN });

      expect(bankTx.bankTxReturn).toBe(bankTxReturn);
    });

    it('creates the repeat order', async () => {
      const bankTx = createCustomBankTx({ id: 1, type: null, creditDebitIndicator: BankTxIndicator.CREDIT });

      await service.updateInternal(bankTx, { type: BankTxType.BANK_TX_REPEAT });

      expect(bankTxRepeatService.create).toHaveBeenCalledWith(bankTx);
    });

    it('carries an explicitly passed user onto the transaction', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      const user = Object.assign(new User(), { id: 3, userData });
      const transaction = { id: 9 } as never;
      const bankTx = createCustomBankTx({ id: 1, type: null, transaction });

      await service.updateInternal(bankTx, { type: BankTxType.FIAT_FIAT }, user);

      expect(transactionService.updateInternal).toHaveBeenCalledWith(transaction, {
        type: TransactionTypeInternal.FIAT_FIAT,
        user,
        userData,
      });
    });

    it('falls back to the user already on the row', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      const user = Object.assign(new User(), { id: 3, userData });
      const transaction = { id: 9, user } as never;
      const bankTx = createCustomBankTx({ id: 1, type: null, transaction });

      await service.updateInternal(bankTx, { type: BankTxType.FIAT_FIAT });

      expect(transactionService.updateInternal).toHaveBeenCalledWith(transaction, {
        type: TransactionTypeInternal.FIAT_FIAT,
        user,
        userData,
      });
    });

    it('writes a plain field update without touching the transaction', async () => {
      const bankTx = createCustomBankTx({ id: 1, type: BankTxType.GSHEET });

      await service.updateInternal(bankTx, { highRisk: true } as UpdateBankTxDto);

      expect(transactionService.updateInternal).not.toHaveBeenCalled();
      expect(bankTxRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 1, highRisk: true }));
    });
  });

  describe('#reset(...)', () => {
    it('fails loud for an unknown id', async () => {
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(undefined);

      await expect(service.reset(1)).rejects.toThrow(NotFoundException);
    });

    it('refuses to reset a row without a buy order', async () => {
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(createCustomBankTx({ id: 1, buyCrypto: null }));

      await expect(service.reset(1)).rejects.toThrow(BadRequestException);
    });

    it('refuses to reset a completed buy order', async () => {
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(
        createCustomBankTx({ id: 1, buyCrypto: { isComplete: true } as never }),
      );

      await expect(service.reset(1)).rejects.toThrow(BadRequestException);

      expect(buyCryptoService.delete).not.toHaveBeenCalled();
    });

    it('deletes the order and puts the row back into the pending queue', async () => {
      const buyCrypto = { isComplete: false } as never;
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(createCustomBankTx({ id: 1, buyCrypto }));

      await service.reset(1);

      expect(buyCryptoService.delete).toHaveBeenCalledWith(buyCrypto);
      expect(bankTxRepo.update).toHaveBeenCalledWith(1, { remittanceInfo: null, type: BankTxType.PENDING });
    });
  });

  describe('#getBankTxByKey(...)', () => {
    it('joins the full compliance graph and accepts a plain column name', async () => {
      const qb = useSingleQueryBuilder();
      const bankTx = createCustomBankTx({ id: 1 });
      qb.getOne.mockResolvedValue(bankTx);

      await expect(service.getBankTxByKey('accountServiceRef', 'REF-1')).resolves.toBe(bankTx);

      expect(qb.where).toHaveBeenCalledWith('bankTx.accountServiceRef = :param', { param: 'REF-1' });
      expect(qb.leftJoinAndSelect).toHaveBeenCalledWith('userData.kycSteps', 'kycSteps');
    });

    it('leaves an already qualified key untouched and can stop after the default relations', async () => {
      const qb = useSingleQueryBuilder();
      qb.getOne.mockResolvedValue(undefined);

      await service.getBankTxByKey('transaction.uid', 'T-1', true);

      expect(qb.where).toHaveBeenCalledWith('transaction.uid = :param', { param: 'T-1' });
      expect(qb.leftJoinAndSelect).not.toHaveBeenCalledWith('userData.kycSteps', 'kycSteps');
    });
  });

  describe('#getBankTxByTransactionId(...)', () => {
    it('resolves the row behind a transaction', async () => {
      const bankTx = createCustomBankTx({ id: 1 });
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(bankTx);

      await expect(service.getBankTxByTransactionId(9, { transaction: true })).resolves.toBe(bankTx);

      expect(bankTxRepo.findOne).toHaveBeenCalledWith({
        where: { transaction: { id: 9 } },
        relations: { transaction: true },
      });
    });
  });

  describe('#getBankTxsByTransactionIds(...)', () => {
    it('does not query for an empty id list', async () => {
      await expect(service.getBankTxsByTransactionIds([])).resolves.toEqual([]);

      expect(bankTxRepo.find).not.toHaveBeenCalled();
    });

    it('resolves the rows behind the given transactions', async () => {
      const bankTx = createCustomBankTx({ id: 1 });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([bankTx]);

      await expect(service.getBankTxsByTransactionIds([9, 10])).resolves.toEqual([bankTx]);
    });
  });

  describe('#getBankTxById(...)', () => {
    it('resolves the row by id', async () => {
      const bankTx = createCustomBankTx({ id: 1 });
      (bankTxRepo.findOne as jest.Mock).mockResolvedValue(bankTx);

      await expect(service.getBankTxById(1)).resolves.toBe(bankTx);

      expect(bankTxRepo.findOne).toHaveBeenCalledWith({ where: { id: 1 }, relations: undefined });
    });
  });

  describe('#getPendingTx()', () => {
    it('lists the incoming rows that are still waiting for a classification', async () => {
      (bankTxRepo.findBy as jest.Mock).mockResolvedValue([]);

      await service.getPendingTx();

      const [unclassified, retryable] = (bankTxRepo.findBy as jest.Mock).mock.calls[0][0];
      expect(unclassified.creditDebitIndicator).toBe(BankTxIndicator.CREDIT);
      expect(retryable.creditDebitIndicator).toBe(BankTxIndicator.CREDIT);
      expect((retryable.type as FindOperator<BankTxType[]>).value).toEqual([
        BankTxType.PENDING,
        BankTxType.UNKNOWN,
        BankTxType.GSHEET,
      ]);
    });
  });

  describe('#getBankTxFee(...)', () => {
    it('skips a fee aggregate with an unusable direction instead of guessing its sign', async () => {
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();
      mockLegacyFee(null);
      mockFeeAggregates([{ currency: 'EUR', creditDebitIndicator: null as never, amount: '100' }]);
      mockChfPrices();

      await expect(service.getBankTxFee(from)).resolves.toBe(0);

      expect(error).toHaveBeenCalledTimes(1);
      expect(pricingService.getPrice).not.toHaveBeenCalled();
    });

    it('does not fetch a price for a currency that nets to zero', async () => {
      mockLegacyFee(null);
      mockFeeAggregates([
        { currency: 'EUR', creditDebitIndicator: BankTxIndicator.DEBIT, amount: '100' },
        { currency: 'EUR', creditDebitIndicator: BankTxIndicator.CREDIT, amount: '100' },
      ]);
      mockChfPrices();

      await expect(service.getBankTxFee(from)).resolves.toBe(0);

      expect(pricingService.getPrice).not.toHaveBeenCalled();
    });
  });

  describe('#getRecentExchangeTx(...)', () => {
    it('reads forward from a known id without a date bound', async () => {
      (bankTxRepo.findBy as jest.Mock).mockResolvedValue([]);

      await service.getRecentExchangeTx(500, BankTxType.KRAKEN);

      const where = (bankTxRepo.findBy as jest.Mock).mock.calls[0][0];
      expect((where.id as FindOperator<number>).value).toBe(500);
      expect(where.created).toBeUndefined();
    });

    it('falls back to a three week window for a first run', async () => {
      (bankTxRepo.findBy as jest.Mock).mockResolvedValue([]);

      await service.getRecentExchangeTx(0, BankTxType.KRAKEN);

      const where = (bankTxRepo.findBy as jest.Mock).mock.calls[0][0];
      expect(where.id).toBeUndefined();
      expect((where.created as FindOperator<Date>).value).toBeInstanceOf(Date);
    });
  });

  describe('#storeSepaFile(...)', () => {
    // one transaction manager for both nesting levels: storeSepaFile's own transaction and the one
    // BaseRepository.saveMany opens per batch inside it
    function transactionManager(): Record<string, jest.Mock> {
      const manager: Record<string, jest.Mock> = {
        save: jest.fn(async (entity) => entity),
        transaction: jest.fn(async (callback: (m: unknown) => Promise<unknown>) => callback(manager)),
      };
      return manager;
    }

    function mockSepaFile(entries: Partial<BankTx>[], duplicates: Partial<BankTx>[]): Record<string, jest.Mock> {
      const manager = transactionManager();

      (sepaParser.parseSepaFile as jest.Mock).mockReturnValue({ document: true });
      (sepaParser.parseBatch as jest.Mock).mockReturnValue({
        identification: 'BATCH-1',
        iban: 'CH-DFX',
        bankBalanceAfter: 500,
      });
      (sepaParser.parseEntries as jest.Mock).mockResolvedValue(entries);
      (bankTxBatchRepo.create as jest.Mock).mockImplementation((values) => ({ ...values }));
      (bankTxRepo.create as jest.Mock).mockImplementation((values) => Object.assign(new BankTx(), values));
      (bankTxRepo.findBy as jest.Mock).mockResolvedValue(duplicates);
      (specialAccountService.getMultiAccounts as jest.Mock).mockResolvedValue([]);
      (transactionService.create as jest.Mock).mockImplementation(async () => ({ id: 9 }));
      (bankService.getBankByIban as jest.Mock).mockResolvedValue({ id: 2, iban: 'CH-DFX' });
      jest.spyOn(service, 'getType').mockResolvedValue(null);
      Object.defineProperty(bankTxBatchRepo, 'manager', { configurable: true, value: manager });

      return manager;
    }

    it('stores the batch with its entries and publishes the new bank balance', async () => {
      mockSepaFile([{ accountServiceRef: 'A' }, { accountServiceRef: 'B' }], []);
      const balances: unknown[] = [];
      service.bankBalanceObservable.subscribe((update) => balances.push(update));

      const batch = await service.storeSepaFile('<Document/>');

      expect(transactionService.create).toHaveBeenCalledTimes(2);
      expect(batch.transactions).toHaveLength(2);
      // the entries carry the batch on the way in, but it is cut out of the returned graph so the
      // controller can serialise it without recursing
      expect(batch.transactions.every((tx) => tx.batch === null)).toBe(true);
      expect(balances).toEqual([{ bank: { id: 2, iban: 'CH-DFX' }, iban: 'CH-DFX', balance: 500 }]);
      expect(notificationService.sendMail).not.toHaveBeenCalled();
    });

    it('reports duplicate entries and imports only the remaining ones', async () => {
      mockSepaFile([{ accountServiceRef: 'A' }, { accountServiceRef: 'B' }], [{ accountServiceRef: 'A' }]);
      const error = jest.spyOn(service['logger'], 'error').mockImplementation();

      const batch = await service.storeSepaFile('<Document/>');

      expect(error).toHaveBeenCalledTimes(1);
      expect(notificationService.sendMail).toHaveBeenCalledWith({
        type: MailType.ERROR_MONITORING,
        context: MailContext.SEPA,
        input: { subject: 'SEPA Error', errors: [expect.stringContaining('BATCH-1')] },
      });
      expect(batch.transactions).toHaveLength(1);
      expect(batch.transactions[0].accountServiceRef).toBe('B');
    });
  });

  describe('#getType(...)', () => {
    it.each([
      ['Scrypt Digital Trading AG', BankTxType.SCRYPT],
      ['SCB AG', BankTxType.SCB],
      ['Some Customer', null],
    ])('classifies the counterparty %s as %s', async (name, expected) => {
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(false);

      await expect(service.getType(createCustomBankTx({ name }))).resolves.toBe(expected);
    });

    it('stays unclassified for a row without a counterparty name', async () => {
      jest.spyOn(bankService, 'areKnownBankIbans').mockResolvedValue(false);

      await expect(service.getType(createCustomBankTx({ name: undefined }))).resolves.toBeNull();
    });
  });

  describe('#getUnassignedBankTx(...)', () => {
    it('searches incoming unassigned rows by sender account and by vIBAN', async () => {
      (bankTxRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getUnassignedBankTx(['DE-SENDER'], ['CH-VIBAN']);

      const { where, relations } = (bankTxRepo.find as jest.Mock).mock.calls[0][0];
      expect(relations).toEqual({ transaction: true });
      expect(where).toHaveLength(2);
      expect((where[0].type as FindOperator<BankTxType[]>).value).toEqual(BankTxUnassignedTypes);
      expect(where[0].creditDebitIndicator).toBe(BankTxIndicator.CREDIT);
      expect((where[0].senderAccount as FindOperator<string[]>).value).toEqual(['DE-SENDER']);
      expect((where[1].virtualIban as FindOperator<string[]>).value).toEqual(['CH-VIBAN']);
    });
  });

  describe('#getBankTxsByVirtualIban(...)', () => {
    it('loads the rows of a vIBAN together with their account', async () => {
      (bankTxRepo.find as jest.Mock).mockResolvedValue([]);

      await service.getBankTxsByVirtualIban('CH-VIBAN');

      expect(bankTxRepo.find).toHaveBeenCalledWith({
        where: { virtualIban: 'CH-VIBAN' },
        relations: { transaction: { userData: true } },
      });
    });
  });

  describe('#getBankTxsByName(...)', () => {
    // The compliance name search has to find a payer whose bank writes the name in a different
    // order than the account does, so it searches the reversed splits as well.
    function searchedPatterns(): string[] {
      const { where } = (bankTxRepo.find as jest.Mock).mock.calls[0][0];
      return (where as Record<string, unknown>[]).map(
        (condition) => ((condition.name ?? condition.ultimateName) as FindOperator<string>).value,
      );
    }

    beforeEach(() => {
      (bankTxRepo.find as jest.Mock).mockResolvedValue([]);
    });

    it('searches the name itself and its reversed split, on both name columns', async () => {
      await service.getBankTxsByName('John Doe');

      expect(searchedPatterns()).toEqual(['%John Doe%', '%John Doe%', '%Doe John%', '%Doe John%']);
    });

    it('adds a title-free variant of the name', async () => {
      await service.getBankTxsByName('Dr. John Doe');

      const patterns = searchedPatterns();
      // the full string without the title, plus the reversed splits of both variants
      expect(patterns).toContain('%John Doe%');
      expect(patterns).toContain('%Doe John%');
      expect(patterns).toContain('%Doe Dr. John%');
    });

    it('keeps the title when dropping it would leave a single word', async () => {
      await service.getBankTxsByName('Dr. Doe');

      // 'Doe' alone is far too broad for a compliance search, so no title-free variant is added
      expect(searchedPatterns()).toEqual(['%Dr. Doe%', '%Dr. Doe%', '%Doe Dr.%', '%Doe Dr.%']);
    });

    it('caps a long name at five parts and ignores repeated separators', async () => {
      await service.getBankTxsByName('A  B C D E F');

      const patterns = searchedPatterns();
      expect(patterns[0]).toBe('%A  B C D E F%');
      // the split variant stops after five parts, so 'F' never becomes part of a reversed pattern
      expect(patterns).toContain('%A B C D E%');
      expect(patterns.some((pattern) => pattern.includes('F%') && pattern !== '%A  B C D E F%')).toBe(false);
    });

    it('restricts the search to the incoming rows compliance may reassign', async () => {
      await service.getBankTxsByName('John Doe');

      const { where, relations } = (bankTxRepo.find as jest.Mock).mock.calls[0][0];
      expect(relations).toEqual({ transaction: true });
      expect(where[0].creditDebitIndicator).toBe(BankTxIndicator.CREDIT);
      expect((where[0].type as FindOperator<BankTxType[]>).value).toContain(BankTxType.BANK_TX_RETURN);
    });
  });

  describe('#checkAssignAndNotifyUserData(...)', () => {
    it('leaves a row alone that is already assigned to an account', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      const assigned = createCustomBankTx({
        id: 1,
        transaction: { id: 9, userData: Object.assign(new UserData(), { id: 6 }) } as never,
      });
      (bankTxRepo.find as jest.Mock).mockResolvedValue([assigned]);

      await service.checkAssignAndNotifyUserData('DE12500105170648489890', userData);

      expect(transactionService.updateInternal).not.toHaveBeenCalled();
      expect(transactionNotificationService.sendUnassignedTxMail).not.toHaveBeenCalled();
    });
  });

  describe('#findMatchingBuy(...)', () => {
    const buys = [{ id: 42, bankUsage: 'ABC-123' }];

    it('matches the remittance info regardless of separators and case', async () => {
      const tx = createCustomBankTx({ remittanceInfo: 'payment abc 123 thanks' });

      expect(service['findMatchingBuy'](tx, buys)).toBe(buys[0]);
    });

    it('reads a zero written as the letter O', async () => {
      const tx = createCustomBankTx({ remittanceInfo: 'ABC-12O' });

      const buy = { id: 42, bankUsage: 'ABC-120' };

      expect(service['findMatchingBuy'](tx, [buy])).toBe(buy);
    });

    it('falls back to the end-to-end id and ignores a placeholder remittance info', async () => {
      const tx = createCustomBankTx({ remittanceInfo: '-', endToEndId: 'ABC123' });

      expect(service['findMatchingBuy'](tx, buys)).toBe(buys[0]);
    });

    it('returns nothing when neither reference matches', async () => {
      const tx = createCustomBankTx({ remittanceInfo: 'unrelated', endToEndId: '-' });

      expect(service['findMatchingBuy'](tx, buys)).toBeUndefined();
    });
  });

  describe('getters', () => {
    it('exposes the repository for the callers that build their own queries', () => {
      expect(service.getBankTxRepo()).toBe(bankTxRepo);
    });
  });

  describe('#getUserDataForBankTx(...)', () => {
    it('takes the account of the vIBAN, which is mandatory when set', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      (virtualIbanService.getByIban as jest.Mock).mockResolvedValue({ userData });

      const bankTx = createCustomBankTx({ virtualIban: 'CH-VIBAN', senderAccount: 'DE-SENDER' });

      await expect(service.getUserDataForBankTx(bankTx)).resolves.toBe(userData);
      expect(bankDataService.getVerifiedBankDataWithIban).not.toHaveBeenCalled();
    });

    it('resolves an unassigned vIBAN to no account rather than falling back to the sender', async () => {
      (virtualIbanService.getByIban as jest.Mock).mockResolvedValue(undefined);

      const bankTx = createCustomBankTx({ virtualIban: 'CH-VIBAN', senderAccount: 'DE-SENDER' });

      await expect(service.getUserDataForBankTx(bankTx)).resolves.toBeUndefined();
    });

    it('restricts the sender lookup to one account when an account is given', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      (bankDataService.getValidBankDatasForUser as jest.Mock).mockResolvedValue([{ userData }]);

      const bankTx = createCustomBankTx({ virtualIban: null, senderAccount: 'DE-SENDER' });

      await expect(service.getUserDataForBankTx(bankTx, 5, false)).resolves.toBe(userData);
      expect(bankDataService.getValidBankDatasForUser).toHaveBeenCalledWith(5, false, 'DE-SENDER');
    });

    it('searches every verified bank data record when no account is given', async () => {
      const userData = Object.assign(new UserData(), { id: 5 });
      (bankDataService.getVerifiedBankDataWithIban as jest.Mock).mockResolvedValue({ userData });

      const bankTx = createCustomBankTx({ virtualIban: null, senderAccount: 'DE-SENDER' });

      await expect(service.getUserDataForBankTx(bankTx)).resolves.toBe(userData);
      expect(bankDataService.getVerifiedBankDataWithIban).toHaveBeenCalledWith(
        'DE-SENDER',
        undefined,
        undefined,
        { userData: { wallet: true } },
        true,
      );
    });

    it('resolves to no account for a row without a vIBAN and without a sender', async () => {
      const bankTx = createCustomBankTx({ virtualIban: null, senderAccount: null });

      await expect(service.getUserDataForBankTx(bankTx)).resolves.toBeUndefined();
    });
  });
});
