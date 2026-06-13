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

  // --- ADDITIONAL TYPE / ERROR BRANCHES --- //

  it('books PENDING CRDT to LIABILITY/unattributed (same branch as GSHEET CRDT)', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.PENDING,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'EUR-IBAN',
        amount: 1000,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'LIABILITY/unattributed')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books PENDING DBIT to SUSPENSE (non-credit unattributed → SUSPENSE)', async () => {
    mockBatch([
      bankTx({
        type: BankTxType.PENDING,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.2 buyCryptoLegs guard: BUY_CRYPTO without buyCrypto.amountInChf throws → failure-isolation
  it('throws (failure-isolation) on BUY_CRYPTO without buyCrypto.amountInChf', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      bankTx({ id: 7, type: BankTxType.BUY_CRYPTO, accountIban: 'CHF-IBAN', amount: 1000, buyCrypto: undefined }),
    ]);
    await consumer.process();
    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → watermark not advanced
  });

  // §4.2 defensive default: an unmapped bank_tx type (bad DB data) → buildLegs default → undefined → skipped
  it('skips an unmapped bank_tx type (defensive default branch)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([bankTx({ id: 8, type: 'WeirdType' as BankTxType, accountIban: 'CHF-IBAN', amount: 100 })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(8); // skip (not error) → watermark advances
  });

  // §4.2 bankContext no-bank-match fallback: no accountIban → untracked, currency from the tx → SUSPENSE/untracked
  it('books an UNKNOWN with no accountIban against an untracked SUSPENSE from the tx currency', async () => {
    mockBatch([
      bankTx({
        id: 9,
        type: BankTxType.UNKNOWN,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: null, // no bank match → untracked, currency from tx
        currency: 'CHF',
        amount: 100,
      }),
    ]);
    await consumer.process();
    // untracked CHF → SUSPENSE leg + the bank leg is a SUSPENSE/untracked-bank-unknown-CHF account (CHF → mark 1)
    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE/untracked-bank-unknown-CHF')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.2a BUY_CRYPTO_RETURN cutover-straddling: the owed-Dr anchors on the CUTOVER opening CHF (per-row marker),
  // NOT the completion CHF — so owed closes cent-exact to 0 even for a row whose owed was opened by the cutover.
  it('BUY_CRYPTO_RETURN anchors the owed-Dr on the cutover opening CHF for a straddling row', async () => {
    jest.spyOn(settingService, 'get').mockResolvedValue('1557344'); // cutover ran, logId 1557344
    const cutoverLeg = { account: { name: 'LIABILITY/buyCrypto-owed' }, amountChf: -48000 } as any;
    jest
      .spyOn(ledgerTxRepo, 'findOne')
      .mockImplementation(({ where }: any) =>
        where?.sourceType === 'cutover' && where?.sourceId === '1557344:buy_crypto-owed:88'
          ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [cutoverLeg] }) as any)
          : Promise.resolve(null),
      );
    // completion (if it were used) = 49500 − 100 = 49400 → distinct from the 48000 opening on purpose
    const buyCrypto = { id: 88, amountInChf: 49500, totalFeeAmountChf: 100 } as any;
    mockBatch([
      bankTx({
        id: 90,
        type: BankTxType.BUY_CRYPTO_RETURN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 50000, // EUR-mark 0.95 → bank-Cr −47500
        buyCrypto,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const owed = legs.find((l) => l.account.name === 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(48000); // the CUTOVER opening anchor, NOT the 49400 completion CHF
    expect(legs.find((l) => l.account === eurBankAccount).amountChf).toBe(-47500); // EUR-mark × amount
    expect(cents(legs)).toBe(0); // the 48000 − 47500 = 500 drift closes via the fx plug
  });

  // §4.2 CHECKOUT_LTD with no acquirer fee (chargeAmountChf null → 0): no EXPENSE/acquirer-fee leg, brutto == netto
  it('books CHECKOUT_LTD with no acquirer fee (chargeAmountChf null → no fee leg)', async () => {
    createdAccounts.set('Checkout/CHF', account('Checkout/CHF', AccountType.ASSET, 'CHF', 271));
    mockBatch([
      bankTx({
        type: BankTxType.CHECKOUT_LTD,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
        chargeAmountChf: null, // no fee → fee leg skipped, brutto = netto
      }),
    ]);
    await consumer.process();
    const legs = booked[0].legs;
    expect(legs.some((l) => l.account.name === 'EXPENSE/acquirer-fee')).toBe(false);
    const checkout = legs.find((l) => l.account.name === 'Checkout/CHF');
    expect(checkout.amountChf).toBe(-100); // brutto == netto (no fee)
    expect(cents(legs)).toBe(0);
  });

  // --- §4.12 CONTENT-CHANGE SCAN (reconcileBooking) --- //

  it('content-change scan: reverses+rebooks an already-booked row whose legs changed (§4.12)', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(false);
    const changed = bankTx({
      id: 30,
      type: BankTxType.EXTRAORDINARY_EXPENSES,
      creditDebitIndicator: BankTxIndicator.DEBIT,
      accountIban: 'CHF-IBAN',
      amount: 200,
    });
    // forward id-scan empty; content-change scan (where.updated) returns the changed row
    jest
      .spyOn(bankTxRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1);
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('30'); // recomputed seq0 legs for the changed row
    expect(reverseSpy).not.toHaveBeenCalled(); // still a bookable type → reverse-and-rebook, NOT a flat reversal
  });

  it('content-change scan: flat-reverses a row whose type became a skip type (buildSeq0Input undefined)', async () => {
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(true);
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false);
    // the row flipped to BUY_FIAT (a skip type) → buildSeq0Input undefined → flat reversal at (bank_tx, id, 0)
    const becameSkip = bankTx({
      id: 31,
      type: BankTxType.BUY_FIAT,
      creditDebitIndicator: BankTxIndicator.DEBIT,
      accountIban: 'CHF-IBAN',
      amount: 100,
    });
    jest
      .spyOn(bankTxRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [becameSkip] : []));

    await consumer.process();

    expect(reverseSpy).toHaveBeenCalledWith('bank_tx', '31', 0); // flat reversal at the booked identifiers
    expect(rebookSpy).not.toHaveBeenCalled();
  });

  // --- ADDITIONAL BRANCH COVERAGE --- //

  // §4.12 content-change scan callback `tx.bookingDate ?? tx.created` — a re-classified row whose bookingDate is null
  // → the scan preloads marks at tx.created (the null-side of the ?? in the scan callback, source line 94).
  it('content-change scan uses tx.created for the mark window when bookingDate is null (line 94 null side)', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const preloadSpy = jest.spyOn(markService, 'preload');
    const created = new Date('2026-05-20T00:00:00Z');
    const changed = bankTx({
      id: 40,
      type: BankTxType.EXTRAORDINARY_EXPENSES,
      creditDebitIndicator: BankTxIndicator.DEBIT,
      accountIban: 'CHF-IBAN',
      amount: 200,
      created,
      bookingDate: null, // null → the scan callback falls back to tx.created for the mark window
    });
    jest
      .spyOn(bankTxRepo, 'find')
      .mockImplementation(({ where }: any) => Promise.resolve(where?.updated != null ? [changed] : []));

    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1);
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('40');
    // the scan callback preload (the LAST preload call) was invoked with tx.created on both bounds (bookingDate null)
    const lastPreload = preloadSpy.mock.calls[preloadSpy.mock.calls.length - 1];
    expect(lastPreload[0]).toBe(created);
    expect(lastPreload[1]).toBe(created);
  });

  // §4.2 buildSeq0Input `tx.bookingDate ?? tx.created` + `tx.valueDate ?? bookingDate` — a forward row with BOTH
  // bookingDate AND valueDate null → both settlement dates fall back to tx.created (source lines 153/154 null sides).
  it('buildSeq0Input falls back to tx.created for both bookingDate and valueDate when null (lines 153/154 null sides)', async () => {
    const created = new Date('2026-05-21T00:00:00Z');
    mockBatch([
      bankTx({
        id: 41,
        type: BankTxType.EXTRAORDINARY_EXPENSES,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 200,
        created,
        bookingDate: null, // → bookingDate = created
        valueDate: null, // → valueDate = bookingDate = created
      }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(1);
    expect(booked[0].bookingDate).toBe(created);
    expect(booked[0].valueDate).toBe(created);
  });

  // §4.2a buyCryptoOwedChf guard: a BUY_CRYPTO_RETURN whose buyCrypto.amountInChf is null AND no cutover opening →
  // throws (source line 279) → failure-isolation, nothing booked, watermark not advanced.
  it('throws (failure-isolation) on BUY_CRYPTO_RETURN without buyCrypto.amountInChf and no cutover (line 279)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    const buyCrypto = { id: 91, amountInChf: null } as any; // no completion anchor; default mocks → no cutover opening
    mockBatch([
      bankTx({
        id: 92,
        type: BankTxType.BUY_CRYPTO_RETURN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 1000,
        buyCrypto,
      }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → watermark stays put
  });

  // §4.2a buyCryptoOwedChf `totalFeeAmountChf ?? 0` null side (source line 280): a return whose buyCrypto has
  // amountInChf set but totalFeeAmountChf null → owed = amountInChf − 0 (CHF account → no fee subtracted, no plug).
  it('BUY_CRYPTO_RETURN owed-Dr uses amountInChf − 0 when totalFeeAmountChf is null (line 280 null side)', async () => {
    const buyCrypto = { id: 93, amountInChf: 1000, totalFeeAmountChf: null } as any;
    mockBatch([
      bankTx({
        id: 94,
        type: BankTxType.BUY_CRYPTO_RETURN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 1000,
        buyCrypto,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const owed = legs.find((l) => l.account.name === 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(1000); // amountInChf (1000) − (totalFeeAmountChf ?? 0 = 0)
    expect(legs.find((l) => l.account === chfBankAccount).amountChf).toBe(-1000);
    expect(cents(legs)).toBe(0);
  });

  // §6.1 cutoverOwedOpeningChf leg amountChf null (source line 295): a cutover opening tx exists for the buy_crypto but
  // its buyCrypto-owed leg carries amountChf == null → cutoverOwedOpeningChf returns undefined → fall back to the
  // completion CHF (amountInChf − totalFeeAmountChf).
  it('BUY_CRYPTO_RETURN falls back to completion CHF when the cutover owed leg amountChf is null (line 295)', async () => {
    jest.spyOn(settingService, 'get').mockResolvedValue('1557344'); // cutover ran
    const cutoverLeg = { account: { name: 'LIABILITY/buyCrypto-owed' }, amountChf: null } as any; // null → undefined
    jest
      .spyOn(ledgerTxRepo, 'findOne')
      .mockImplementation(({ where }: any) =>
        where?.sourceType === 'cutover' && where?.sourceId === '1557344:buy_crypto-owed:95'
          ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [cutoverLeg] }) as any)
          : Promise.resolve(null),
      );
    const buyCrypto = { id: 95, amountInChf: 1000, totalFeeAmountChf: 40 } as any;
    mockBatch([
      bankTx({
        id: 96,
        type: BankTxType.BUY_CRYPTO_RETURN,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 1000,
        buyCrypto,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const owed = legs.find((l) => l.account.name === 'LIABILITY/buyCrypto-owed');
    expect(owed.amountChf).toBe(960); // completion CHF = 1000 − 40 (NOT the null cutover leg)
    expect(cents(legs)).toBe(0);
  });

  // §4.2a transferLegs counter-leg undefined side (source lines 342-344): a KRAKEN on an UNTRACKED EUR bank with NO
  // same-currency tracked mark → the bank leg needsMark (amountChf undefined) → the TRANSIT counter leg also carries
  // amountChf undefined + needsMark true (the `bank.amountChf != null ? … : undefined` else branch).
  it('KRAKEN on an untracked bank with no mark: TRANSIT counter leg is needsMark/amountChf undefined (lines 342-344)', async () => {
    mockBatch(
      [
        bankTx({
          id: 97,
          type: BankTxType.KRAKEN,
          creditDebitIndicator: BankTxIndicator.DEBIT,
          accountIban: 'UNTRACKED-IBAN',
          amount: 500,
        }),
      ],
      undefined,
    );
    // override: untracked EUR bank + NO tracked EUR bank for the currency mark lookup → mark unresolvable
    jest.spyOn(bankRepo, 'findOne').mockImplementation((opts: any) => {
      const iban = opts?.where?.iban;
      if (iban === 'UNTRACKED-IBAN')
        return Promise.resolve(Object.assign(new Bank(), { name: 'Raiffeisen', currency: 'EUR', asset: null }));
      return Promise.resolve(null); // currency lookup → no tracked EUR bank
    });
    await consumer.process();

    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    const transit = legs.find((l) => l.account.name === 'TRANSIT/bank↔Kraken/EUR');
    expect(bank.amount).toBe(-500); // DBIT
    expect(bank.needsMark).toBe(true);
    expect(bank.amountChf).toBeUndefined();
    expect(transit.amount).toBe(500); // -bank.amount
    expect(transit.amountChf).toBeUndefined(); // else side of `bank.amountChf != null ? -bank.amountChf : undefined`
    expect(transit.needsMark).toBe(true); // inherits bank.needsMark
  });

  // §4.2a suspenseLegs counter-leg undefined side (source line 563): an UNKNOWN on an untracked EUR bank with NO mark
  // → the bank leg needsMark → the SUSPENSE counter leg carries amountChf undefined + needsMark true.
  it('UNKNOWN on an untracked bank with no mark: SUSPENSE counter leg is needsMark/amountChf undefined (line 563)', async () => {
    mockBatch(
      [
        bankTx({
          id: 98,
          type: BankTxType.UNKNOWN,
          creditDebitIndicator: BankTxIndicator.CREDIT,
          accountIban: 'UNTRACKED-IBAN',
          amount: 500,
        }),
      ],
      undefined,
    );
    jest.spyOn(bankRepo, 'findOne').mockImplementation((opts: any) => {
      const iban = opts?.where?.iban;
      if (iban === 'UNTRACKED-IBAN')
        return Promise.resolve(Object.assign(new Bank(), { name: 'Raiffeisen', currency: 'EUR', asset: null }));
      return Promise.resolve(null);
    });
    await consumer.process();

    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    const suspense = legs.find((l) => l.account.name === 'SUSPENSE');
    expect(bank.amount).toBe(500); // CREDIT
    expect(bank.needsMark).toBe(true);
    expect(bank.amountChf).toBeUndefined();
    expect(suspense.amount).toBe(-500); // -bank.amount
    expect(suspense.amountChf).toBeUndefined(); // else side of the ?? : undefined
    expect(suspense.needsMark).toBe(true);
  });

  // §4.2 bankAccountFeeLegs `tx.chargeAmount ?? tx.amount` + `tx.chargeAmountChf ?? -(bank.amountChf ?? 0)` null sides
  // (source lines 355-357): chargeAmount null → uses tx.amount; chargeAmountChf null → expense = −bank.amountChf.
  it('BANK_ACCOUNT_FEE with chargeAmount/chargeAmountChf null uses tx.amount and −bank.amountChf (lines 355-357)', async () => {
    mockBatch([
      bankTx({
        id: 99,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 50, // used as the charge because chargeAmount is null
        chargeAmount: null,
        chargeAmountChf: null,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account === eurBankAccount);
    const expense = legs.find((l) => l.account.name === 'EXPENSE/bank-fee');
    expect(bank.amount).toBe(-50); // −charge, charge = tx.amount (chargeAmount null)
    expect(bank.amountChf).toBe(-47.5); // EUR-mark 0.95 × 50
    expect(expense.amountChf).toBe(47.5); // −(bank.amountChf) since chargeAmountChf null
    expect(legs.some((l) => l.account.name?.includes('fx-revaluation'))).toBe(false); // expense == −bank → no residual
    expect(cents(legs)).toBe(0);
  });

  // §4.2 liabilityCreditLegs `-(bank.amountChf ?? 0)` bank.amountChf null side (source line 392): a BANK_TX_RETURN on
  // an untracked bank with no mark → bank leg amountChf undefined → liability leg uses −0 = 0.
  it('BANK_TX_RETURN on an untracked bank with no mark: liability uses 0 (line 392 null side)', async () => {
    mockBatch(
      [
        bankTx({
          id: 100,
          type: BankTxType.BANK_TX_RETURN,
          creditDebitIndicator: BankTxIndicator.CREDIT,
          accountIban: 'UNTRACKED-IBAN',
          amount: 100,
        }),
      ],
      undefined,
    );
    jest.spyOn(bankRepo, 'findOne').mockImplementation((opts: any) => {
      const iban = opts?.where?.iban;
      if (iban === 'UNTRACKED-IBAN')
        return Promise.resolve(Object.assign(new Bank(), { name: 'Raiffeisen', currency: 'EUR', asset: null }));
      return Promise.resolve(null);
    });
    await consumer.process();

    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    const liability = legs.find((l) => l.account.name === 'LIABILITY/bankTx-return');
    expect(bank.needsMark).toBe(true);
    expect(bank.amountChf).toBeUndefined();
    expect(liability.amountChf).toBe(-0); // −(bank.amountChf ?? 0) = −0 (the null-coalesce fallback)
  });

  // §4.2 cutoverOpeningLiabilityChf `cutoverLogId == null` (source line 500): a BANK_TX_RETURN_CHARGEBACK whose
  // chargeback resolves to an opening bank_tx id (via the return repo) but there is NO bank_tx seq0 opening leg AND no
  // cutover → cutoverOpeningLiabilityChf bails on the null logId → fall back to the −Σ(others) close value.
  it('BANK_TX_RETURN_CHARGEBACK with an opening id but no seq0 leg and no cutover falls back to close value (line 500)', async () => {
    jest
      .spyOn(bankTxReturnRepo, 'findOne')
      .mockResolvedValue(Object.assign(new BankTxReturn(), { bankTx: { id: 70 } }) as any); // opening id resolved
    // ledgerTxRepo.findOne stays the default null → no bank_tx seq0 opening leg; settingService.get stays undefined
    mockBatch([
      bankTx({
        id: 71,
        type: BankTxType.BANK_TX_RETURN_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
        chargeAmountChf: 5,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const liability = legs.find((l) => l.account.name === 'LIABILITY/bankTx-return');
    // CHF bank-Cr = −100, fee = +5 → fallback close value = −(−100 + 5) = 95
    expect(liability.amountChf).toBe(95);
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(false); // self-balances → no plug
    expect(cents(legs)).toBe(0);
  });

  // §6.1 cutoverOpeningLiabilityChf `bucket === 'bankTx-repeat'` marker branch (source line 502): a cutover-straddling
  // BANK_TX_REPEAT_CHARGEBACK whose opening is only in the cutover under the 'bank_tx-repeat' marker → anchors on it.
  it('BANK_TX_REPEAT_CHARGEBACK cutover-straddling anchors via the bank_tx-repeat marker (line 502 repeat branch)', async () => {
    jest
      .spyOn(bankTxRepeatRepo, 'findOne')
      .mockResolvedValue(Object.assign(new BankTxRepeat(), { bankTx: { id: 80 } }) as any);
    jest.spyOn(settingService, 'get').mockResolvedValue('1557344'); // cutover ran
    const cutoverLeg = { account: { name: 'LIABILITY/bankTx-repeat' }, amountChf: -92 } as any;
    jest.spyOn(ledgerTxRepo, 'findOne').mockImplementation(({ where }: any) =>
      // only the cutover marker resolves (no bank_tx seq0 opening); marker uses 'bank_tx-repeat'
      where?.sourceType === 'cutover' && where?.sourceId === '1557344:bank_tx-repeat:80'
        ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [cutoverLeg] }) as any)
        : Promise.resolve(null),
    );
    mockBatch([
      bankTx({
        id: 81,
        type: BankTxType.BANK_TX_REPEAT_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 100, // EUR-mark 0.95 → bank-Cr −95
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'LIABILITY/bankTx-repeat').amountChf).toBe(92); // cutover anchor
    expect(legs.find((l) => l.account.name === 'Olkypay/EUR').amountChf).toBe(-95); // EUR-mark × amount
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(true); // +92 − 95 = −3 drift plugged
    expect(cents(legs)).toBe(0);
  });

  // §6.1 cutoverOpeningLiabilityChf cutover leg amountChf == null (source line 508): the cutover marker resolves a tx
  // but its liability leg carries amountChf null → cutoverOpeningLiabilityChf returns undefined → fall back to the
  // −Σ(others) close value.
  it('BANK_TX_RETURN_CHARGEBACK falls back to close value when the cutover opening leg amountChf is null (line 508)', async () => {
    jest
      .spyOn(bankTxReturnRepo, 'findOne')
      .mockResolvedValue(Object.assign(new BankTxReturn(), { bankTx: { id: 72 } }) as any);
    jest.spyOn(settingService, 'get').mockResolvedValue('1557344');
    const cutoverLeg = { account: { name: 'LIABILITY/bankTx-return' }, amountChf: null } as any; // null → undefined
    jest
      .spyOn(ledgerTxRepo, 'findOne')
      .mockImplementation(({ where }: any) =>
        where?.sourceType === 'cutover' && where?.sourceId === '1557344:bank_tx-return:72'
          ? Promise.resolve(Object.assign(new LedgerTx(), { legs: [cutoverLeg] }) as any)
          : Promise.resolve(null),
      );
    mockBatch([
      bankTx({
        id: 73,
        type: BankTxType.BANK_TX_RETURN_CHARGEBACK,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN',
        amount: 100,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    // no usable opening anchor → fallback close value = −(bank −100) = 100 (CHF, no fee)
    expect(legs.find((l) => l.account.name === 'LIABILITY/bankTx-return').amountChf).toBe(100);
    expect(legs.some((l) => l.account.name.endsWith('/fx-revaluation'))).toBe(false);
    expect(cents(legs)).toBe(0);
  });

  // §4.2 checkoutLtdLegs grossChf needsMark side (source lines 528-534): a CHECKOUT_LTD on an untracked bank with NO
  // mark → bank leg needsMark (netChf undefined) → grossChf undefined → the Checkout custody leg needsMark, amountChf
  // undefined.
  it('CHECKOUT_LTD on an untracked bank with no mark: Checkout custody leg is needsMark/amountChf undefined (lines 528-534)', async () => {
    createdAccounts.set('Checkout/EUR', account('Checkout/EUR', AccountType.ASSET, 'EUR', 270));
    mockBatch(
      [
        bankTx({
          id: 101,
          type: BankTxType.CHECKOUT_LTD,
          creditDebitIndicator: BankTxIndicator.CREDIT,
          accountIban: 'UNTRACKED-IBAN',
          amount: 100,
          chargeAmountChf: 0, // no fee leg, isolate the grossChf needsMark branch
        }),
      ],
      undefined,
    );
    jest.spyOn(bankRepo, 'findOne').mockImplementation((opts: any) => {
      const iban = opts?.where?.iban;
      if (iban === 'UNTRACKED-IBAN')
        return Promise.resolve(Object.assign(new Bank(), { name: 'Raiffeisen', currency: 'EUR', asset: null }));
      return Promise.resolve(null); // no tracked EUR bank → mark unresolvable
    });
    await consumer.process();

    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    const checkout = legs.find((l) => l.account.name === 'Checkout/EUR');
    expect(bank.needsMark).toBe(true);
    expect(bank.amountChf).toBeUndefined(); // netChf undefined
    expect(checkout.amount).toBe(-100); // -tx.amount (native still booked)
    expect(checkout.amountChf).toBeUndefined(); // grossChf undefined → no CHF
    expect(checkout.needsMark).toBe(true); // grossChf == null
  });

  // §4.2a withFxPlug residual POSITIVE side (source lines 606-607): a BANK_ACCOUNT_FEE on EUR where the Pricing
  // chargeAmountChf is BELOW the EUR-mark bank value → the residual is ≥ 0 → INCOME/fx-revaluation (the existing fee
  // test hits the EXPENSE side; this hits the INCOME side).
  it('BANK_ACCOUNT_FEE routes a positive residual to INCOME/fx-revaluation (lines 606-607 positive side)', async () => {
    // EUR-mark 0.95 × 50 = bank-Cr −47.5; chargeAmountChf (expense Dr) = 47.0 → sum = −0.5 → residual +0.5 (>2c) →
    // INCOME/fx-revaluation +0.5 closes the tx.
    mockBatch([
      bankTx({
        id: 102,
        type: BankTxType.BANK_ACCOUNT_FEE,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'EUR-IBAN',
        amount: 50,
        chargeAmount: 50,
        chargeAmountChf: 47.0,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const plug = legs.find((l) => l.account.name?.includes('fx-revaluation'));
    expect(plug.account.name).toBe('INCOME/fx-revaluation'); // residual ≥ 0 → INCOME, NOT EXPENSE
    expect(plug.amountChf).toBe(0.5);
    expect(cents(legs)).toBe(0);
  });

  // §4.2 bankAccount throw (source line 618): a TRACKED bank whose findByAssetId returns undefined (CoA bootstrap
  // missing) → throws → failure-isolation, nothing booked, watermark unchanged.
  it('throws (failure-isolation) when a tracked bank has no ledger account (CoA bootstrap missing, line 618)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(undefined); // tracked bank → no CoA account
    mockBatch([
      bankTx({
        id: 103,
        type: BankTxType.EXTRAORDINARY_EXPENSES,
        creditDebitIndicator: BankTxIndicator.DEBIT,
        accountIban: 'CHF-IBAN', // tracked bank (asset id 100)
        amount: 100,
      }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → watermark not advanced
  });

  // §4.2 bankContext `tx.currency ?? CHF` null side (source line 666): no bank match AND tx.currency null → currency
  // defaults to CHF → SUSPENSE/untracked-bank-unknown-CHF (CHF → mark 1, 2-leg, no plug).
  it('bankContext defaults to CHF when there is no bank match and tx.currency is null (line 666 null side)', async () => {
    mockBatch([
      bankTx({
        id: 104,
        type: BankTxType.UNKNOWN,
        creditDebitIndicator: BankTxIndicator.CREDIT,
        accountIban: null, // no bank match
        currency: null, // → currency defaults to CHF
        amount: 100,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const bank = legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-unknown-CHF');
    expect(bank).toBeDefined(); // currency resolved to CHF
    expect(bank.amount).toBe(100);
    expect(bank.amountChf).toBe(100); // CHF → mark 1
    expect(bank.needsMark).toBe(false);
    expect(cents(legs)).toBe(0);
  });
});
