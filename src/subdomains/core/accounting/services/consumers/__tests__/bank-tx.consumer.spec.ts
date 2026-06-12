import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Bank } from 'src/subdomains/supporting/bank/bank/bank.entity';
import { BankTx, BankTxIndicator, BankTxType } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { BankTxRepeat } from 'src/subdomains/supporting/bank-tx/bank-tx-repeat/bank-tx-repeat.entity';
import { BankTxReturn } from 'src/subdomains/supporting/bank-tx/bank-tx-return/bank-tx-return.entity';
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
  let bankTxReturnRepo: Repository<BankTxReturn>;
  let bankTxRepeatRepo: Repository<BankTxRepeat>;

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
    bankTxReturnRepo = createMock<Repository<BankTxReturn>>();
    bankTxRepeatRepo = createMock<Repository<BankTxRepeat>>();

    // by default no cutover opening exists → BUY_CRYPTO_RETURN owed-Dr falls back to the completion CHF
    jest.spyOn(ledgerTxRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(settingService, 'get').mockResolvedValue(undefined);
    // by default a chargeback resolves to no opening row → opening-CHF lookup falls back to the close value
    jest.spyOn(bankTxReturnRepo, 'findOne').mockResolvedValue(null);
    jest.spyOn(bankTxRepeatRepo, 'findOne').mockResolvedValue(null);

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
        { provide: getRepositoryToken(BankTxReturn), useValue: bankTxReturnRepo },
        { provide: getRepositoryToken(BankTxRepeat), useValue: bankTxRepeatRepo },
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

      // §4.2a representative same-currency tracked-bank lookup (currencyMarkAssetId): an untracked EUR bank borrows
      // the EUR mark from a tracked EUR bank asset (here Olkypay/EUR = 269). No iban → this is the currency lookup.
      if (iban == null && opts?.where?.currency === 'EUR')
        return Promise.resolve(Object.assign(new Bank(), { name: 'Olkypay', currency: 'EUR', asset: eurAsset }));

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

  it('books BUY_CRYPTO on an untracked Raiffeisen bank as a 3-leg fx-plug against SUSPENSE (§4.2a SUSPENSE variant)', async () => {
    // §4.2a Raiffeisen-untracked: the SUSPENSE leg is EUR-mark-valued via the representative same-currency tracked-bank
    // asset (0.95 × 10000 = 9500), received = amountInChf (9480), plug = the −20 valuation residual — NOT a full-value
    // phantom. The SUSPENSE leg carries assetId=null but a real CHF (the mark comes from a tracked EUR bank, not the
    // SUSPENSE account itself); the plug is the small Mark↔Pricing drift, identical to the tracked-EUR-bank §4.2a case.
    const buyCrypto = { amountInChf: 9480 } as any;
    mockBatch([bankTx({ type: BankTxType.BUY_CRYPTO, accountIban: 'UNTRACKED-IBAN', amount: 10000, buyCrypto })]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs).toHaveLength(3);
    const suspense = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    expect(suspense).toBeDefined();
    expect(suspense.amount).toBe(10000); // native EUR (awaits the §4.3b sweep)
    expect(suspense.amountChf).toBe(9500); // EUR-mark × amount, mark-consistent — NOT a needsMark hole
    expect(suspense.needsMark).toBe(false);
    const received = legs.find((l) => l.account.name === 'LIABILITY/buyCrypto-received');
    expect(received.amountChf).toBe(-9480); // base anchor (fully counted, Class-4 fix)
    const plug = legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(plug.account.name).toBe('EXPENSE/fx-revaluation');
    expect(plug.amountChf).toBe(-20); // small valuation residual (Mark↔Pricing), NOT the full +9480 phantom
    expect(cents(legs)).toBe(0);
  });

  it('books BUY_CRYPTO on an untracked bank with NO same-currency tracked mark as a needsMark leg, no silent plug', async () => {
    // when no tracked bank of the currency exists, currencyMarkAssetId returns undefined → the SUSPENSE leg stays
    // needsMark and withFxPlug books NO plug (§5.1 Stufe 3: no silent plug without a mark; mark-to-market revalues)
    const buyCrypto = { amountInChf: 9480 } as any;
    mockBatch(
      [bankTx({ type: BankTxType.BUY_CRYPTO, accountIban: 'UNTRACKED-IBAN', amount: 10000, buyCrypto })],
      undefined,
    );
    // override: no tracked EUR bank → the currency lookup returns null
    jest.spyOn(bankRepo, 'findOne').mockImplementation((opts: any) => {
      const iban = opts?.where?.iban;
      if (iban === 'UNTRACKED-IBAN')
        return Promise.resolve(Object.assign(new Bank(), { name: 'Raiffeisen', currency: 'EUR', asset: null }));
      return Promise.resolve(null); // currency lookup finds no tracked EUR bank
    });
    await consumer.process();

    const legs = booked[0].legs;
    const suspense = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    expect(suspense.needsMark).toBe(true); // no mark resolvable
    expect(legs.find((l) => l.account.name?.includes('fx-revaluation'))).toBeUndefined(); // NO silent plug
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

  // §4.2 B-15 (Major design-accounting): the chargeback debits the liability with the CHF it was OPENED with (the
  // BANK_TX_RETURN credit's CHF), NOT the chargeback-time bank-mark close value. On an EUR account where the mark
  // drifted between opening and chargeback, the drift must land in fx-revaluation, NOT stay a phantom on bankTx-return.
  it('BANK_TX_RETURN_CHARGEBACK on EUR uses the OPENING CHF anchor + routes the mark drift to fx-revaluation', async () => {
    // the original BANK_TX_RETURN opening bank_tx #50 opened LIABILITY/bankTx-return at EUR-mark@open: 100 EUR × 0.92 =
    // 92 CHF. The chargeback at EUR-mark@chargeback 0.95 would value the bank leg at −95 CHF.
    jest
      .spyOn(bankTxReturnRepo, 'findOne')
      .mockResolvedValue(Object.assign(new BankTxReturn(), { bankTx: { id: 50 } }) as any);
    const openingLeg = { account: { name: 'LIABILITY/bankTx-return' }, amountChf: -92 } as any;
    jest
      .spyOn(ledgerTxRepo, 'findOne')
      .mockImplementation(({ where }: any) =>
        where?.sourceType === 'bank_tx' && where?.sourceId === '50'
          ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [openingLeg] }) as any)
          : Promise.resolve(null),
      );

    mockBatch([
      bankTx({
        id: 51,
        type: BankTxType.BANK_TX_RETURN_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 100, // EUR
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const liability = legs.find((l) => l.account.name === 'LIABILITY/bankTx-return');
    const bank = legs.find((l) => l.account.name === 'Olkypay/EUR');
    expect(liability.amountChf).toBe(92); // OPENING CHF (Dr), NOT the −(bank) close value 95
    expect(bank.amountChf).toBe(-95); // EUR-mark@chargeback × amount = 100 × 0.95 (mark-consistent for §7)
    // the +92 − 95 = −3 drift must NOT vanish: it closes via an fx-revaluation plug, liability stays at the anchor
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(true);
    expect(cents(legs)).toBe(0);
  });

  // §4.2 (Major design-accounting): symmetric for BANK_TX_REPEAT_CHARGEBACK — opening CHF anchor + fx-plug so
  // bankTx-repeat closes cent-exact even when the EUR mark drifted between the BANK_TX_REPEAT credit and the chargeback.
  it('BANK_TX_REPEAT_CHARGEBACK on EUR uses the OPENING CHF anchor + routes the mark drift to fx-revaluation', async () => {
    jest
      .spyOn(bankTxRepeatRepo, 'findOne')
      .mockResolvedValue(Object.assign(new BankTxRepeat(), { bankTx: { id: 60 } }) as any);
    const openingLeg = { account: { name: 'LIABILITY/bankTx-repeat' }, amountChf: -92 } as any;
    jest
      .spyOn(ledgerTxRepo, 'findOne')
      .mockImplementation(({ where }: any) =>
        where?.sourceType === 'bank_tx' && where?.sourceId === '60'
          ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [openingLeg] }) as any)
          : Promise.resolve(null),
      );

    mockBatch([
      bankTx({
        id: 61,
        type: BankTxType.BANK_TX_REPEAT_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 100, // EUR
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'LIABILITY/bankTx-repeat').amountChf).toBe(92); // opening anchor
    expect(legs.find((l) => l.account.name === 'Olkypay/EUR').amountChf).toBe(-95); // EUR-mark × amount
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(true);
    expect(cents(legs)).toBe(0);
  });

  // no opening at all found (untracked chain / opening older than the 90d cutover lookback, no bank_tx seq0 AND no
  // cutover marker) → fall back to the close value, 2-leg, no plug (the prior behaviour stays intact, tx self-balances)
  it('BANK_TX_REPEAT_CHARGEBACK with no opening row falls back to the close value (2-leg, no plug)', async () => {
    // default mocks: bankTxRepeatRepo.findOne → null (no opening row) + settingService.get → undefined (no cutover)
    mockBatch([
      bankTx({
        type: BankTxType.BANK_TX_REPEAT_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'LIABILITY/bankTx-repeat').amountChf).toBe(100); // close value
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(false); // no drift → no plug
    expect(cents(legs)).toBe(0);
  });

  // §6.1 + §4.2 (Major design-accounting): a cutover-straddling BANK_TX_RETURN (opened pre-cutover by the cutover, NOT
  // a bank_tx seq0 tx) whose chargeback settles post-cutover MUST anchor on the CUTOVER opening-CHF so the
  // LIABILITY/bankTx-return closes cent-exact to 0 — NOT the −Σ(bank+fee) fallback, which would leave it phantom-negative.
  it('BANK_TX_RETURN_CHARGEBACK on a cutover-straddling row anchors on the CUTOVER opening CHF (liability closes to 0)', async () => {
    // chargeback resolves to opening bank_tx #50; there is NO bank_tx seq0 opening (settled pre-cutover, below the
    // watermark) — only the cutover per-row opening `1557344:bank_tx-return:50` (Cr −92 CHF). EUR-mark@chargeback 0.95.
    jest
      .spyOn(bankTxReturnRepo, 'findOne')
      .mockResolvedValue(Object.assign(new BankTxReturn(), { bankTx: { id: 50 } }) as any);
    jest.spyOn(settingService, 'get').mockResolvedValue('1557344'); // cutover happened, logId 1557344
    const cutoverLeg = { account: { name: 'LIABILITY/bankTx-return' }, amountChf: -92 } as any;
    jest
      .spyOn(ledgerTxRepo, 'findOne')
      .mockImplementation(({ where }: any) =>
        where?.sourceType === 'cutover' && where?.sourceId === '1557344:bank_tx-return:50'
          ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [cutoverLeg] }) as any)
          : Promise.resolve(null),
      );

    mockBatch([
      bankTx({
        id: 51,
        type: BankTxType.BANK_TX_RETURN_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 100, // EUR
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'LIABILITY/bankTx-return').amountChf).toBe(92); // CUTOVER opening anchor
    expect(legs.find((l) => l.account.name === 'Olkypay/EUR').amountChf).toBe(-95); // EUR-mark@chargeback × amount
    // +92 − 95 = −3 drift closes via an fx-revaluation plug; the liability stays exactly on the opening anchor → 0
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(true);
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
