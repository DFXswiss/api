import { createMock } from '@golevelup/ts-jest';
import { ConfigService } from 'src/config/config';
import { OlkypayService } from 'src/integration/bank/services/olkypay.service';
import { YapealService } from 'src/integration/bank/services/yapeal.service';
import { createCustomPrice } from 'src/integration/exchange/dto/__mocks__/price.dto.mock';
import { createCustomFiat } from 'src/shared/models/fiat/__mocks__/fiat.entity.mock';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { BuyCryptoService } from 'src/subdomains/core/buy-crypto/process/services/buy-crypto.service';
import { BuyService } from 'src/subdomains/core/buy-crypto/routes/buy/buy.service';
import { BankDataService } from 'src/subdomains/generic/user/models/bank-data/bank-data.service';
import { BankService } from 'src/subdomains/supporting/bank/bank/bank.service';
import { VirtualIbanService } from 'src/subdomains/supporting/bank/virtual-iban/virtual-iban.service';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { SpecialExternalAccountService } from 'src/subdomains/supporting/payment/services/special-external-account.service';
import { TransactionNotificationService } from 'src/subdomains/supporting/payment/services/transaction-notification.service';
import { TransactionService } from 'src/subdomains/supporting/payment/services/transaction.service';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { BankTxRepeatService } from '../../bank-tx-repeat/bank-tx-repeat.service';
import { BankTxReturnService } from '../../bank-tx-return/bank-tx-return.service';
import { createCustomBankTx } from '../__mocks__/bank-tx.entity.mock';
import { BankTx, BankTxIndicator, BankTxType } from '../entities/bank-tx.entity';
import { BankTxBatchRepository } from '../repositories/bank-tx-batch.repository';
import { BankTxRepository } from '../repositories/bank-tx.repository';
import { BankTxFrickService } from '../services/bank-tx-frick.service';
import { BankTxService } from '../services/bank-tx.service';
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
  let bankService: BankService;
  let pricingService: PricingService;
  let fiatService: FiatService;

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
    bankService = createMock<BankService>();
    pricingService = createMock<PricingService>();
    fiatService = createMock<FiatService>();

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
      createMock<BankTxBatchRepository>(),
      createMock<BuyCryptoService>(),
      createMock<NotificationService>(),
      createMock<SettingService>(),
      createMock<OlkypayService>(),
      createMock<BankTxFrickService>(),
      createMock<BankTxReturnService>(),
      createMock<BankTxRepeatService>(),
      createMock<BuyService>(),
      bankService,
      createMock<YapealService>(),
      createMock<TransactionService>(),
      createMock<SpecialExternalAccountService>(),
      createMock<SepaParser>(),
      createMock<BankDataService>(),
      createMock<VirtualIbanService>(),
      createMock<TransactionNotificationService>(),
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
  });
});
