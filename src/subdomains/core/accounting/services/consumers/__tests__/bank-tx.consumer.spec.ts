import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Repository } from 'typeorm';
import { LedgerTx } from '../../../entities/ledger-tx.entity';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { BankTxConsumer } from '../bank-tx.consumer';

const eurAsset = { id: 269 } as any;

function bankTx(values: Partial<BankTx>): BankTx {
  return Object.assign(new BankTx(), {
    id: 1,
    created: new Date('2026-06-01T00:00:00Z'),
    updated: new Date('2026-06-02T00:00:00Z'), // IEntity always sets updated; the §4.12 content-change scan reads it
    bookingDate: new Date('2026-06-02T00:00:00Z'),
    creditDebitIndicator: BankTxIndicator.CREDIT,
    accountIban: 'CHF-IBAN',
    amount: 1000,
    ...values,
  });
}

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

describe('BankTxConsumer', () => {
  let consumer: BankTxConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let bankTxRepo: Repository<BankTx>;
  let bankRepo: Repository<Bank>;
  let ledgerTxRepo: Repository<LedgerTx>;

  let booked: LedgerTxInput[];
  let createdAccounts: Map<string, LedgerAccount>;

  const chfBankAccount = account('Yapeal/CHF', AccountType.ASSET, 'CHF', 100);
  const eurBankAccount = account('Olkypay/EUR', AccountType.ASSET, 'EUR', 269);

  beforeEach(async () => {
    booked = [];
    createdAccounts = new Map();

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    bankTxRepo = createMock<Repository<BankTx>>();
    bankRepo = createMock<Repository<Bank>>();
    ledgerTxRepo = createMock<Repository<LedgerTx>>();

    // by default no cutover opening exists → BUY_CRYPTO_RETURN owed-Dr falls back to the completion CHF
    jest.spyOn(ledgerTxRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(settingService, 'get').mockResolvedValue(undefined);

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });

    jest
      .spyOn(accountService, 'findByAssetId')
      .mockImplementation((assetId: number) => Promise.resolve(assetId === 269 ? eurBankAccount : chfBankAccount));
    jest
      .spyOn(accountService, 'findByName')
      .mockImplementation((name: string) => Promise.resolve(createdAccounts.get(name)));
    jest
      .spyOn(accountService, 'findOrCreate')
      .mockImplementation((name: string, type: AccountType, currency: string) => {
        const existing = createdAccounts.get(name);
        if (existing) return Promise.resolve(existing);
        const acc = account(name, type, currency);
        createdAccounts.set(name, acc);
        return Promise.resolve(acc);
      });

    // CHF mark default = 1, EUR mark default = 0.95 (overridable per test)
    jest
      .spyOn(markService, 'preload')
      .mockResolvedValue(new LedgerMarkCache(new Map([[269, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]]])));

    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        BankTxConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(BankTx), useValue: bankTxRepo },
        { provide: getRepositoryToken(Bank), useValue: bankRepo },
        { provide: getRepositoryToken(LedgerTx), useValue: ledgerTxRepo },
      ],
    }).compile();

    consumer = module.get<BankTxConsumer>(BankTxConsumer);
  });

  function mockBatch(rows: BankTx[], bank?: Partial<Bank>): void {
    // forward id-scan (where.id) returns the rows; the §4.12 content-change scan (where.updated MoreThan) returns []
    // so the unit tests assert only the forward booking — the reversal path is covered by its own scan tests below
    jest
      .spyOn(bankTxRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [] : rows));
    jest.spyOn(bankRepo, 'findOne').mockImplementation((opts: any) => {
      const iban = opts?.where?.iban;
      if (iban === 'EUR-IBAN')
        return Promise.resolve(
          Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: eurAsset, ...bank }),
        );
      if (iban === 'UNTRACKED-IBAN')
        return Promise.resolve(
          Object.assign(new Bank(), { name: 'Raiffeisen', currency: 'EUR', asset: null, ...bank }),
        );
      if (iban === 'CHF-IBAN')
        return Promise.resolve(
          Object.assign(new Bank(), { name: 'Yapeal', currency: 'CHF', asset: { id: 100 }, ...bank }),
        );
      return Promise.resolve(null);
    });
  }

  const cents = (legs: LedgerLegInput[]) =>
    legs.reduce((s, l) => s + Math.round(Math.round((l.amountChf ?? 0) * 100)), 0);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  it('skips BUY_FIAT rows entirely (single-booker, Blocker R4-1)', async () => {
    mockBatch([bankTx({ type: BankTxType.BUY_FIAT, creditDebitIndicator: BankTxIndicator.DEBIT })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  it('skips TEST_FIAT_FIAT rows (mapper=null)', async () => {
    mockBatch([bankTx({ type: BankTxType.TEST_FIAT_FIAT })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  it('books BUY_CRYPTO CRDT on a CHF bank as a 2-leg tx (no fx plug)', async () => {
    const buyCrypto = { amountInChf: 1000 } as any;
    mockBatch([bankTx({ type: BankTxType.BUY_CRYPTO, accountIban: 'CHF-IBAN', amount: 1000, buyCrypto })]);
    await consumer.process();

    expect(booked).toHaveLength(1);
    const legs = booked[0].legs;
    expect(legs).toHaveLength(2);
    expect(legs[0].account).toBe(chfBankAccount);
    expect(legs[0].amountChf).toBe(1000);
    const received = legs[1];
    expect(received.account.name).toBe('LIABILITY/buyCrypto-received');
    expect(received.amountChf).toBe(-1000);
    expect(cents(legs)).toBe(0);
  });

  it('books BUY_CRYPTO CRDT on an EUR bank as a 3-leg fx-plug tx (§4.2a)', async () => {
    // EUR-mark 0.95 × 10000 = 9500 bank leg; amountInChf 9480 → plug −20 → EXPENSE/fx-revaluation
    const buyCrypto = { amountInChf: 9480 } as any;
    mockBatch([bankTx({ type: BankTxType.BUY_CRYPTO, accountIban: 'EUR-IBAN', amount: 10000, buyCrypto })]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs).toHaveLength(3);
    expect(legs[0].account).toBe(eurBankAccount);
    expect(legs[0].amountChf).toBe(9500); // mark-consistent, NOT amountInChf
    expect(legs[1].account.name).toBe('LIABILITY/buyCrypto-received');
    expect(legs[1].amountChf).toBe(-9480); // base anchor
    const plug = legs[2];
    expect(plug.account.name).toBe('EXPENSE/fx-revaluation');
    expect(plug.amountChf).toBe(-20);
    expect(cents(legs)).toBe(0);
  });

  it('books BUY_CRYPTO on an untracked Raiffeisen bank against SUSPENSE/untracked-bank-Raiffeisen-EUR', async () => {
    const buyCrypto = { amountInChf: 9480 } as any;
    mockBatch([bankTx({ type: BankTxType.BUY_CRYPTO, accountIban: 'UNTRACKED-IBAN', amount: 10000, buyCrypto })]);
    await consumer.process();

    const legs = booked[0].legs;
    // untracked → no EUR mark via asset → SUSPENSE leg needsMark; the received anchor remains; plug absorbs
    expect(legs[0].account.name).toBe('SUSPENSE/untracked-bank-Raiffeisen-EUR');
    expect(legs[0].needsMark).toBe(true);
    expect(legs[1].account.name).toBe('LIABILITY/buyCrypto-received');
    expect(cents(legs)).toBe(0);
  });

  it('books BUY_CRYPTO_RETURN on an EUR bank: owed-Dr = completion CHF, fx-plug absorbs the mark drift (§4.2a/R2-2)', async () => {
    // owed was opened at completion CHF = amountInChf − totalFeeAmountChf = 9480 − 30 = 9450; the EUR-return
    // settlement mark gives bank-Cr = 0.95 × 10000 = −9500 → owed must NOT be set to +9500 (that would null the
    // plug). owed-Dr +9450, bank-Cr −9500 → fx-plug +50 → INCOME/fx-revaluation, owed closes to 0.
    const buyCrypto = { id: 77, amountInChf: 9480, totalFeeAmountChf: 30 } as any;
    mockBatch([
      bankTx({
        type: BankTxType.BUY_CRYPTO_RETURN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 10000,
        buyCrypto,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const owed = legs.find((l) => l.account.name === 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(9450); // completion CHF (amountInChf − totalFeeAmountChf), NOT −(bank-mark)
    const bank = legs.find((l) => l.account === eurBankAccount);
    expect(bank.amountChf).toBe(-9500); // EUR-mark × amount (mark-consistent)
    const plug = legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(plug).toBeDefined(); // the 50-CHF drift IS plugged (would be 0 with the old −(bank) owed value)
    expect(plug.account.name).toBe('INCOME/fx-revaluation');
    expect(plug.amountChf).toBe(50);
    expect(cents(legs)).toBe(0);
  });

  it('books BUY_CRYPTO_RETURN on a CHF bank as a 2-leg tx (drift 0, no plug)', async () => {
    // CHF account: amount == amountInChf, completion CHF = 1000 − 0 = 1000, bank-Cr = −1000 → plug 0 → 2-leg
    const buyCrypto = { id: 78, amountInChf: 1000, totalFeeAmountChf: 0 } as any;
    mockBatch([
      bankTx({
        type: BankTxType.BUY_CRYPTO_RETURN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 1000,
        buyCrypto,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs).toHaveLength(2);
    const owed = legs.find((l) => l.account.name === 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(1000);
    expect(legs.find((l) => l.account === chfBankAccount).amountChf).toBe(-1000);
    expect(cents(legs)).toBe(0);
  });

  it('books KRAKEN DBIT as Dr TRANSIT/bank↔Kraken / Cr ASSET/bank (CHF, route nets to 0)', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.KRAKEN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 500,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const transit = legs.find((l) => l.account.name === 'TRANSIT/bank↔Kraken/CHF');
    const bank = legs.find((l) => l.account === chfBankAccount);
    expect(transit).toBeDefined();
    expect(bank).toBeDefined();
    expect(bank.amount).toBe(-500); // DBIT reduces bank
    expect(transit.amount).toBe(500);
    expect(cents(legs)).toBe(0);
  });

  it('books KRAKEN CRDT as Dr ASSET/bank / Cr TRANSIT/bank↔Kraken', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.KRAKEN,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'CHF-IBAN',
        amount: 500,
      }),
    ]);
    await consumer.process();
    const bank = booked[0].legs.find((l) => l.account === chfBankAccount);
    expect(bank.amount).toBe(500);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books INTERNAL against TRANSIT/bank↔bank', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.INTERNAL,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 300,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'TRANSIT/bank↔bank/CHF')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books FIAT_FIAT single-row against TRANSIT/internal-fx', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.FIAT_FIAT,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'CHF-IBAN',
        amount: 300,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'TRANSIT/internal-fx/CHF')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books BANK_ACCOUNT_FEE: EXPENSE/bank-fee (chargeAmountChf) / ASSET/bank, EUR-mark-consistent + fx plug', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 50,
        chargeAmount: 50,
        chargeAmountChf: 48.2,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const expense = legs.find((l) => l.account.name === 'EXPENSE/bank-fee');
    expect(expense.amountChf).toBe(48.2); // Pricing anchor
    const bank = legs.find((l) => l.account === eurBankAccount);
    expect(bank.amountChf).toBe(-47.5); // EUR-mark × chargeAmount (0.95 × 50)
    const plug = legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(plug).toBeDefined(); // 0.70 CHF residual > 2c → fx plug, not ROUNDING
    expect(cents(legs)).toBe(0);
  });

  it('books EXTRAORDINARY_EXPENSES: EXPENSE/extraordinary / ASSET/bank', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.EXTRAORDINARY_EXPENSES,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 200,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'EXPENSE/extraordinary')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books BANK_TX_RETURN CRDT: ASSET/bank / LIABILITY/bankTx-return', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.BANK_TX_RETURN,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'LIABILITY/bankTx-return')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books BANK_TX_REPEAT CRDT: ASSET/bank / LIABILITY/bankTx-repeat', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.BANK_TX_REPEAT,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'LIABILITY/bankTx-repeat')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books BANK_TX_REPEAT_CHARGEBACK DBIT: LIABILITY/bankTx-repeat / ASSET/bank', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.BANK_TX_REPEAT_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    const liability = booked[0].legs.find((l) => l.account.name === 'LIABILITY/bankTx-repeat');
    expect(liability.amountChf).toBe(100);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books BANK_TX_RETURN_CHARGEBACK DBIT with EXPENSE/bank-fee', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.BANK_TX_RETURN_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
        chargeAmountChf: 5,
      }),
    ]);
    await consumer.process();
    const legs = booked[0].legs;
    expect(legs.some((l) => l.account.name === 'LIABILITY/bankTx-return')).toBe(true);
    expect(legs.some((l) => l.account.name === 'EXPENSE/bank-fee' && l.amountChf === 5)).toBe(true);
    expect(cents(legs)).toBe(0);
  });

  it('books CHECKOUT_LTD CRDT: ASSET/bank netto + EXPENSE/acquirer-fee / ASSET/Checkout brutto (CHF cross-asset)', async () => {
    createdAccounts.set('Checkout/EUR', account('Checkout/EUR', AccountType.ASSET, 'EUR', 270));
    mockBatch([
      bankTx({
        type: BankTxType.CHECKOUT_LTD,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'EUR-IBAN',
        amount: 100,
        chargeAmountChf: 3,
        accountingAmountAfterFeeChf: 95,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.some((l) => l.account.name === 'EXPENSE/acquirer-fee' && l.amountChf === 3)).toBe(true);
    const checkout = legs.find((l) => l.account.name === 'Checkout/EUR');
    expect(checkout.amountChf).toBe(-(95 + 3)); // brutto = netto + fee (Minor R3-5)
    expect(cents(legs)).toBe(0);
  });

  it('books GSHEET CRDT to LIABILITY/unattributed (EUR-mark in both legs)', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.GSHEET,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'EUR-IBAN',
        amount: 1000,
      }),
    ]);
    await consumer.process();
    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account === eurBankAccount);
    const liab = legs.find((l) => l.account.name === 'LIABILITY/unattributed');
    expect(bank.amountChf).toBe(950); // EUR-mark × amount
    expect(liab.amountChf).toBe(-950); // same CHF, 2-leg, no fx plug
    expect(legs).toHaveLength(2);
    expect(cents(legs)).toBe(0);
  });

  it('books GSHEET DBIT to SUSPENSE', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.GSHEET,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books UNKNOWN against SUSPENSE', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.UNKNOWN,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('advances the watermark only after a successful batch and stops on a booking error (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest
      .spyOn(bookingService, 'bookTx')
      .mockResolvedValueOnce({} as any)
      .mockRejectedValueOnce(new Error('boom'));

    mockBatch([
      bankTx({
        id: 5,
        type: BankTxType.EXTRAORDINARY_EXPENSES,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 10,
      }),
      bankTx({
        id: 6,
        type: BankTxType.EXTRAORDINARY_EXPENSES,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 10,
      }),
    ]);

    await consumer.process();

    // watermark advanced to 5 (the successful row), not 6
    expect(setSpy).toHaveBeenCalledTimes(1);
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(5);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    const setSpy = jest.spyOn(settingService, 'set');
    await consumer.process();
    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
