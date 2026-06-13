import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { BankTx } from 'src/subdomains/supporting/bank-tx/bank-tx/entities/bank-tx.entity';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerLegRepository } from '../../../repositories/ledger-leg.repository';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { ExchangeTxConsumer } from '../exchange-tx.consumer';

function exchangeTx(values: Partial<ExchangeTx>): ExchangeTx {
  return Object.assign(new ExchangeTx(), {
    id: 1,
    created: new Date('2026-06-01T00:00:00Z'),
    externalCreated: new Date('2026-06-01T00:00:00Z'),
    updated: new Date('2026-06-02T00:00:00Z'), // IEntity always sets updated; the §4.3 content-change scan reads it
    exchange: ExchangeName.SCRYPT,
    status: 'ok',
    ...values,
  });
}

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

describe('ExchangeTxConsumer', () => {
  let consumer: ExchangeTxConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let exchangeTxRepo: Repository<ExchangeTx>;
  let bankTxRepo: Repository<BankTx>;
  let ledgerLegRepository: LedgerLegRepository;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;

  // mark map: asset id 50 (Scrypt/EUR), 51 (Scrypt/CHF), 60 (Scrypt/USDT)
  const markMap = new Map([
    [50, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]],
    [51, [{ created: new Date('2026-01-01'), priceChf: 1 }]],
    [60, [{ created: new Date('2026-01-01'), priceChf: 0.9 }]],
  ]);

  beforeEach(async () => {
    booked = [];
    accounts = new Map([
      ['Scrypt/EUR', account('Scrypt/EUR', AccountType.ASSET, 'EUR', 50)],
      ['Scrypt/CHF', account('Scrypt/CHF', AccountType.ASSET, 'CHF', 51)],
      ['Scrypt/USDT', account('Scrypt/USDT', AccountType.ASSET, 'USDT', 60)],
      ['Binance/USDT', account('Binance/USDT', AccountType.ASSET, 'USDT', 60)],
      ['Binance/BTC', account('Binance/BTC', AccountType.ASSET, 'BTC', 70)],
    ]);

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    exchangeTxRepo = createMock<Repository<ExchangeTx>>();
    bankTxRepo = createMock<Repository<BankTx>>();
    ledgerLegRepository = createMock<LedgerLegRepository>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockResolvedValue(0);

    jest.spyOn(accountService, 'findByName').mockImplementation((name: string) => Promise.resolve(accounts.get(name)));
    jest
      .spyOn(accountService, 'findOrCreate')
      .mockImplementation((name: string, type: AccountType, currency: string) => {
        const existing = accounts.get(name);
        if (existing) return Promise.resolve(existing);
        const acc = account(name, type, currency);
        accounts.set(name, acc);
        return Promise.resolve(acc);
      });

    jest.spyOn(markService, 'preload').mockResolvedValue(new LedgerMarkCache(markMap));
    jest.spyOn(settingService, 'getObj').mockResolvedValue(undefined);
    jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue([]);
    jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        ExchangeTxConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(ExchangeTx), useValue: exchangeTxRepo },
        { provide: getRepositoryToken(BankTx), useValue: bankTxRepo },
        { provide: LedgerLegRepository, useValue: ledgerLegRepository },
      ],
    }).compile();

    consumer = module.get<ExchangeTxConsumer>(ExchangeTxConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);

  function mockBatch(rows: ExchangeTx[]): void {
    jest.spyOn(exchangeTxRepo, 'find').mockImplementation((opts: any) => {
      // the §4.3 content-change scan (where.updated is a combined-cursor Raw) returns [] → the forward path is asserted
      // in isolation; the ok→failed reversal path has its own dedicated tests (mockContentChange below)
      if (opts?.where?.updated != null) return Promise.resolve([]);
      // the fill-index preload re-queries with type=Trade — return the same trade rows for ranking
      if (opts?.where?.order != null) return Promise.resolve(rows.filter((r) => r.type === ExchangeTxType.TRADE));
      return Promise.resolve(rows);
    });
  }

  // wires the forward scan empty and the §4.3 content-change scan to return the given changed rows (status-agnostic)
  function mockContentChange(forward: ExchangeTx[], changed: ExchangeTx[]): void {
    jest.spyOn(exchangeTxRepo, 'find').mockImplementation((opts: any) => {
      if (opts?.where?.updated != null) return Promise.resolve(changed); // the content-change scan rows
      // fill-index preload (status='ok', order in …) ranks among the still-ok trades + the merged batch rows
      if (opts?.where?.order != null)
        return Promise.resolve(
          [...forward, ...changed].filter((r) => r.type === ExchangeTxType.TRADE && r.status === 'ok'),
        );
      return Promise.resolve(forward.filter((r) => opts?.where?.status == null || r.status === opts.where.status));
    });
  }

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  it('books a bank-routed Deposit against TRANSIT/bank↔{ex}/{ccy} (R2)', async () => {
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue([Object.assign(new BankTx(), { amount: 1000 })] as BankTx[]);
    mockBatch([exchangeTx({ id: 1, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'Scrypt/EUR').amount).toBe(1000);
    expect(legs.find((l) => l.account.name === 'TRANSIT/bank↔Scrypt/EUR')).toBeDefined();
    expect(cents(legs)).toBe(0);
  });

  it('routes a wallet Deposit (txId present, no bank match) to TRANSIT/wallet↔{ex}/{ccy} (R3)', async () => {
    mockBatch([
      exchangeTx({
        id: 1,
        type: ExchangeTxType.DEPOSIT,
        currency: 'USDT',
        amount: 1000,
        amountChf: 900,
        txId: '0xabc',
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.find((l) => l.account.name === 'TRANSIT/wallet↔Scrypt/USDT')).toBeDefined();
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('routes an unroutable Deposit to SUSPENSE/{exchange}-deposit-unrouted (R4)', async () => {
    mockBatch([exchangeTx({ id: 1, type: ExchangeTxType.DEPOSIT, currency: 'USDT', amount: 1000, amountChf: 900 })]);
    await consumer.process();
    expect(booked[0].legs.find((l) => l.account.name === 'SUSPENSE/Scrypt-deposit-unrouted/USDT')).toBeDefined();
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('routes a Scrypt/EUR Deposit matching an open Raiffeisen SUSPENSE post to that SUSPENSE (R1/§4.3b)', async () => {
    accounts.set(
      'SUSPENSE/untracked-bank-Raiffeisen-EUR',
      account('SUSPENSE/untracked-bank-Raiffeisen-EUR', AccountType.SUSPENSE, 'EUR'),
    );
    jest
      .spyOn(ledgerLegRepository, 'find')
      .mockResolvedValue([{ amount: 1000, account: { name: 'SUSPENSE/untracked-bank-Raiffeisen-EUR' } } as any]);
    mockBatch([exchangeTx({ id: 1, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();

    const counter = booked[0].legs.find((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    expect(counter).toBeDefined();
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('leaves an ambiguous Raiffeisen sweep (two equal posts) in SUSPENSE without guessing', async () => {
    accounts.set(
      'SUSPENSE/untracked-bank-Raiffeisen-EUR',
      account('SUSPENSE/untracked-bank-Raiffeisen-EUR', AccountType.SUSPENSE, 'EUR'),
    );
    jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([{ amount: 1000 } as any, { amount: 1000 } as any]);
    mockBatch([exchangeTx({ id: 1, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR')).toBe(true);
  });

  it('books a Withdrawal mirror (Dr counter / Cr ASSET)', async () => {
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue([Object.assign(new BankTx(), { amount: 1000 })] as BankTx[]);
    mockBatch([exchangeTx({ id: 1, type: ExchangeTxType.WITHDRAWAL, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();
    const asset = booked[0].legs.find((l) => l.account.name === 'Scrypt/EUR');
    expect(asset.amount).toBe(-1000); // withdrawal reduces exchange asset
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('falls back to the mark when Deposit amountChf is null (Minor R9-4) and flags needsMark when no mark', async () => {
    mockBatch([
      exchangeTx({ id: 1, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: null, txId: '0x1' }),
    ]);
    await consumer.process();
    const asset = booked[0].legs.find((l) => l.account.name === 'Scrypt/EUR');
    expect(asset.amountChf).toBe(950); // mark 0.95 × 1000
    expect(asset.needsMark).toBe(false);

    booked = [];
    accounts.set('Scrypt/XYZ', account('Scrypt/XYZ', AccountType.ASSET, 'XYZ', 999)); // no mark for id 999
    mockBatch([
      exchangeTx({ id: 2, type: ExchangeTxType.DEPOSIT, currency: 'XYZ', amount: 5, amountChf: null, txId: '0x2' }),
    ]);
    await consumer.process();
    const xyz = booked[0].legs.find((l) => l.account.name === 'Scrypt/XYZ');
    expect(xyz.needsMark).toBe(true);
    expect(xyz.amountChf).toBeUndefined();
  });

  it('books a Scrypt buy Trade with ONE persisted spread leg + quote leg as plug (Blocker R6-1)', async () => {
    // base USDT (amount 1000, amountChf 900), quote CHF (cost 905), feeAmountChf = market spread −5 (rebate)
    mockBatch([
      exchangeTx({
        id: 1,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-1',
        amount: 1000,
        amountChf: 900,
        cost: 905,
        feeAmountChf: -5,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    // exactly one spread leg = persisted feeAmountChf; negative → INCOME/spread-Scrypt (rebate, Minor R6-4)
    const spread = legs.filter((l) => l.account.name?.includes('spread-Scrypt'));
    expect(spread).toHaveLength(1);
    expect(spread[0].account.name).toBe('INCOME/spread-Scrypt');
    // quote leg is the plug; no extra mark-based quote-spread leg
    const quote = legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(quote).toBeDefined();
    expect(cents(legs)).toBe(0); // closes without ROUNDING throw
    expect(booked[0].sourceType).toBe('ExchangeTrade');
    expect(booked[0].sourceId).toBe('O-1');
  });

  it('books a positive Scrypt spread to EXPENSE/spread-Scrypt', async () => {
    mockBatch([
      exchangeTx({
        id: 1,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-2',
        amount: 1000,
        amountChf: 900,
        cost: 905,
        feeAmountChf: 5,
      }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'EXPENSE/spread-Scrypt')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('books a ccxt (Binance) Trade with a mark-based quote leg + a separate venue fee leg', async () => {
    // base USDT (amount 1000, amountChf 900 base mark), quote BTC (cost 0.01 × mark), separate fee +2
    markMap.set(70, [{ created: new Date('2026-01-01'), priceChf: 90000 }]); // BTC mark
    mockBatch([
      exchangeTx({
        id: 1,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/BTC',
        side: 'buy',
        order: 'O-3',
        amount: 1000,
        amountChf: 900,
        cost: 0.01,
        feeAmountChf: 2,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    // separate venue fee leg = persisted feeAmountChf
    expect(legs.some((l) => l.account.name === 'EXPENSE/spread-Binance' && l.amountChf === 2)).toBe(true);
    // quote leg carries its own mark (not a plug), value-boundary needs no native check
    expect(legs.find((l) => l.account.name === 'Binance/BTC')).toBeDefined();
    expect(cents(legs)).toBe(0);
  });

  it('routes a Trade with no symbol/side to SUSPENSE/{exchange}-trade-unattributed', async () => {
    mockBatch([
      exchangeTx({ id: 1, type: ExchangeTxType.TRADE, symbol: null, side: null, amount: 100, amountChf: 90 }),
    ]);
    await consumer.process();
    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE/Scrypt-trade-unattributed')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  it('assigns batch-stable, re-run-idempotent fill_index per (exchange, order)', async () => {
    const f1 = exchangeTx({
      id: 10,
      type: ExchangeTxType.TRADE,
      symbol: 'USDT/CHF',
      side: 'buy',
      order: 'O-9',
      amount: 100,
      amountChf: 90,
      cost: 90,
    });
    const f2 = exchangeTx({
      id: 11,
      type: ExchangeTxType.TRADE,
      symbol: 'USDT/CHF',
      side: 'buy',
      order: 'O-9',
      amount: 100,
      amountChf: 90,
      cost: 90,
    });
    mockBatch([f1, f2]);
    await consumer.process();

    const seqs = booked.map((b) => b.seq).sort((a, b) => a - b);
    expect(seqs).toEqual([0, 1]); // deterministic 0-based ranks by id
    expect(booked.every((b) => b.sourceId === 'O-9')).toBe(true);
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      exchangeTx({ id: 7, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 100, amountChf: 95, txId: '0x' }),
    ]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(7);
  });

  // --- §4.3 REVERSAL TRIGGER (status ok→failed/canceled + content change) --- //

  it('flat-reverses a Deposit whose status flipped ok→failed (content-change scan, §4.3)', async () => {
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(true);
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false);
    // forward batch empty; the row now has status='failed' and is selected only by the status-agnostic content scan
    const failed = exchangeTx({ id: 5, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 100, status: 'failed' });
    mockContentChange([], [failed]);
    await consumer.process();

    // ok→failed → flat reversal at the row's booked identifiers (exchange_tx, id, seq 0), NOT a re-book
    expect(reverseSpy).toHaveBeenCalledWith('exchange_tx', '5', 0);
    expect(rebookSpy).not.toHaveBeenCalled();
  });

  it('flat-reverses a Trade whose status flipped ok→canceled at its order/fill-index seq (§4.3)', async () => {
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(true);
    const canceled = exchangeTx({
      id: 12,
      type: ExchangeTxType.TRADE,
      symbol: 'USDT/CHF',
      side: 'buy',
      order: 'O-7',
      amount: 100,
      amountChf: 90,
      cost: 90,
      status: 'canceled',
    });
    mockContentChange([], [canceled]);
    await consumer.process();

    // trade reversal targets sourceType=ExchangeTrade, sourceId=order, seq=fill-index (0 for the only fill of O-7)
    expect(reverseSpy).toHaveBeenCalledWith('ExchangeTrade', 'O-7', 0);
  });

  it('reverses + re-books an ok Deposit whose amount changed (content-change, §4.12)', async () => {
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(true);
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const changedRow = exchangeTx({
      id: 6,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 200,
      amountChf: 190,
      txId: '0x',
    });
    mockContentChange([], [changedRow]);
    await consumer.process();

    // status still 'ok' → recompute legs + reverse-and-rebook-if-changed (NOT a flat reversal)
    expect(rebookSpy).toHaveBeenCalledTimes(1);
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('6');
    expect(reverseSpy).not.toHaveBeenCalled();
  });

  it('content-change scan no-ops a row of an unhandled type (buildSpec undefined → nothing to correct)', async () => {
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(false);
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false);
    // an unhandled type → buildSpec returns undefined → reconcileBooking returns early, no reverse/rebook
    const unhandled = exchangeTx({ id: 8, type: 'Reward' as ExchangeTxType, amount: 1, status: 'ok' });
    mockContentChange([], [unhandled]);
    await consumer.process();

    expect(reverseSpy).not.toHaveBeenCalled();
    expect(rebookSpy).not.toHaveBeenCalled();
  });

  // --- FORWARD ERROR / UNHANDLED-TYPE BRANCHES --- //

  it('skips an unhandled exchange_tx type in the forward scan (buildSpec undefined → no booking)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([exchangeTx({ id: 9, type: 'Reward' as ExchangeTxType, amount: 1 })]);
    await consumer.process();

    expect(booked).toHaveLength(0); // unhandled type → spec undefined → no bookTx
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(9); // skip is not a failure → watermark advances
  });

  it('stops the forward batch and leaves the watermark on a booking error (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    // a deposit whose exchangeAsset is missing → exchangeAssetByCcy throws → break, watermark unchanged
    jest.spyOn(accountService, 'findByName').mockResolvedValue(undefined); // no ledger account → throw
    mockBatch([
      exchangeTx({ id: 10, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 100, amountChf: 95, txId: '0x' }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing
  });

  // §4.3 markValue no-mark: a ccxt Trade whose quote asset has no mark → the quote leg is needsMark and the
  // mark-based quote-spread plug is SKIPPED (no silent plug, §4.3) — the quote leg carries amountChf undefined
  it('flags the ccxt quote leg needsMark and skips the quote-spread plug when the quote mark is missing', async () => {
    accounts.set('Binance/XYZ', account('Binance/XYZ', AccountType.ASSET, 'XYZ', 998)); // no mark for 998
    mockBatch([
      exchangeTx({
        id: 11,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/XYZ',
        side: 'buy',
        order: 'O-11',
        amount: 1000,
        amountChf: 900, // base persisted
        cost: 5,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const quote = booked[0].legs.find((l) => l.account.name === 'Binance/XYZ');
    expect(quote.needsMark).toBe(true); // no mark for the quote asset
    expect(quote.amountChf).toBeUndefined();
    // no mark-based quote-spread plug appended while a leg needsMark (only base + quote legs, no spread plug)
    expect(booked[0].legs.filter((l) => l.account.name?.includes('spread-Binance'))).toHaveLength(0);
  });

  // §4.3 parseSymbol guard: a Trade with a malformed symbol (no '/') is unattributable → SUSPENSE, not a base/quote split
  it('routes a Trade with a malformed symbol (no slash) to SUSPENSE', async () => {
    mockBatch([
      exchangeTx({ id: 12, type: ExchangeTxType.TRADE, symbol: 'USDTCHF', side: 'buy', amount: 100, amountChf: 90 }),
    ]);
    await consumer.process();

    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE/Scrypt-trade-unattributed')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.3 ccxt quote-spread plug: a Binance buy where the base mark and quote mark leave a >2c residual gets a
  // mark-based EXPENSE/INCOME spread-{exchange} plug leg (distinct from the venue fee leg)
  it('appends a mark-based quote-spread plug leg that closes the base↔quote mark residual (ccxt)', async () => {
    markMap.set(70, [{ created: new Date('2026-01-01'), priceChf: 90000 }]); // BTC mark
    // base USDT amountChf 900 (persisted) vs quote BTC cost 0.01 × 90000 = 900 → residual 0; shift the base to
    // create a residual: amountChf 905 base → 905 − 900 = 5 CHF residual → spread plug leg
    mockBatch([
      exchangeTx({
        id: 13,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/BTC',
        side: 'buy',
        order: 'O-13',
        amount: 1000,
        amountChf: 905,
        cost: 0.01,
        feeAmountChf: 0, // no separate venue fee → the residual surfaces only as the mark-based spread plug
      }),
    ]);
    await consumer.process();

    const spread = booked[0].legs.filter((l) => l.account.name?.includes('spread-Binance'));
    expect(spread).toHaveLength(1); // exactly the mark-based quote-spread plug
    expect(cents(booked[0].legs)).toBe(0);
  });

  // §4.3b matchRaiffeisenSweep 'none': the Raiffeisen SUSPENSE account EXISTS (findByName resolves it) but there
  // are NO matching open posts in the ≤5d window (ledgerLegRepository.find → []) → 'none' → routing FALLS THROUGH
  // the R1 block to R2 (bank match here) → TRANSIT/bank↔Scrypt/EUR, NOT the Raiffeisen SUSPENSE.
  it('falls through a Scrypt/EUR Deposit to R2 (TRANSIT) when the Raiffeisen sweep window has no match (none)', async () => {
    accounts.set(
      'SUSPENSE/untracked-bank-Raiffeisen-EUR',
      account('SUSPENSE/untracked-bank-Raiffeisen-EUR', AccountType.SUSPENSE, 'EUR'),
    );
    jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([]); // account exists but no posts → 'none'
    jest.spyOn(bankTxRepo, 'find').mockResolvedValue([Object.assign(new BankTx(), { amount: 1000 })] as BankTx[]);
    mockBatch([exchangeTx({ id: 14, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'TRANSIT/bank↔Scrypt/EUR')).toBeDefined();
    expect(legs.some((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR')).toBe(false);
    expect(cents(legs)).toBe(0);
  });

  // §4.3b matchRaiffeisenSweep 'none' → no bank, no txId → R4 unrouted SUSPENSE (still NOT the Raiffeisen SUSPENSE)
  it('falls through a Scrypt/EUR Deposit to R4 (unrouted SUSPENSE) when neither sweep nor bank nor txId matches', async () => {
    accounts.set(
      'SUSPENSE/untracked-bank-Raiffeisen-EUR',
      account('SUSPENSE/untracked-bank-Raiffeisen-EUR', AccountType.SUSPENSE, 'EUR'),
    );
    jest.spyOn(ledgerLegRepository, 'find').mockResolvedValue([]); // 'none'
    mockBatch([exchangeTx({ id: 15, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'SUSPENSE/Scrypt-deposit-unrouted/EUR')).toBeDefined();
    expect(legs.some((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR')).toBe(false);
    expect(cents(legs)).toBe(0);
  });

  // routeCounterAccount `tx.currency ?? tx.asset`: a wallet Deposit with currency NULL but asset set → ccy resolves
  // from the asset ticker → the routed TRANSIT account name uses the asset ticker (USDT), and exchangeAsset too.
  it('resolves ccy from tx.asset when currency is null (routed account uses the asset ticker)', async () => {
    mockBatch([
      exchangeTx({
        id: 16,
        type: ExchangeTxType.DEPOSIT,
        currency: null,
        asset: 'USDT',
        amount: 1000,
        amountChf: 900,
        txId: '0xfeed',
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'Scrypt/USDT').amount).toBe(1000); // exchangeAsset via asset ticker
    expect(legs.find((l) => l.account.name === 'TRANSIT/wallet↔Scrypt/USDT')).toBeDefined();
    expect(cents(legs)).toBe(0);
  });

  // exchangeAsset throws when BOTH currency and asset are missing (depositSpec calls exchangeAsset FIRST, before
  // routeCounterAccount/hasBankRouteMatch) → failure-isolation: no booking, watermark NOT advanced.
  it('does not book and leaves the watermark when a Deposit has neither currency nor asset (exchangeAsset throws)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([
      exchangeTx({ id: 17, type: ExchangeTxType.DEPOSIT, currency: null, asset: null, amount: 1000, amountChf: 900 }),
    ]);
    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing
  });

  // tradeSpec SELL side (isBuy false), ccxt: baseAmount = −amount, base amountChf = −baseChf; quoteAmount = +cost,
  // quote amountChf = +quoteChf. Base leg amount negative, quote leg positive, cents close to 0.
  it('books a Binance SELL Trade with a negative base leg and a positive quote leg (isBuy false)', async () => {
    markMap.set(70, [{ created: new Date('2026-01-01'), priceChf: 90000 }]); // BTC mark → quote 0.01 × 90000 = 900
    mockBatch([
      exchangeTx({
        id: 18,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/BTC',
        side: 'sell',
        order: 'O-18',
        amount: 1000,
        amountChf: 900, // base persisted
        cost: 0.01,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const base = legs.find((l) => l.account.name === 'Binance/USDT');
    expect(base.amount).toBe(-1000); // sell reduces base
    expect(base.amountChf).toBe(-900); // −baseChf
    const quote = legs.find((l) => l.account.name === 'Binance/BTC');
    expect(quote.amount).toBe(0.01); // +cost
    expect(quote.amountChf).toBe(900); // +quoteChf
    expect(cents(legs)).toBe(0);
  });

  // tradeSpec `tx.amountChf ?? this.markValue(...)`: a ccxt trade with amountChf NULL → baseChf falls to
  // markValue(baseAccount). Binance/USDT mark 0.9 × 1000 = 900 → base leg amountChf computed from the mark.
  it('computes the ccxt base leg amountChf from the mark when tx.amountChf is null', async () => {
    markMap.set(70, [{ created: new Date('2026-01-01'), priceChf: 90000 }]); // BTC mark
    mockBatch([
      exchangeTx({
        id: 19,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/BTC',
        side: 'buy',
        order: 'O-19',
        amount: 1000,
        amountChf: null, // → markValue(Binance/USDT 0.9, 1000) = 900
        cost: 0.01,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const base = booked[0].legs.find((l) => l.account.name === 'Binance/USDT');
    expect(base.amountChf).toBe(900); // mark 0.9 × 1000
    expect(base.needsMark).toBe(false);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // tradeSpec Scrypt `spreadChf !== 0` FALSE side: feeAmountChf == 0 → NO spread leg pushed; the quote leg is the
  // plug that closes the tx (only base + quote legs).
  it('books a Scrypt Trade with feeAmountChf 0 → no spread leg, the quote leg is the plug', async () => {
    mockBatch([
      exchangeTx({
        id: 20,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-20',
        amount: 1000,
        amountChf: 900,
        cost: 905,
        feeAmountChf: 0, // spreadChf 0 → no spread leg
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.some((l) => l.account.name?.includes('spread-Scrypt'))).toBe(false); // no spread leg
    expect(legs).toHaveLength(2); // base + quote plug only
    const quote = legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(quote.amountChf).toBe(-900); // plug = −base = −900 (closes the tx)
    expect(cents(legs)).toBe(0);
  });

  // tradeSpec ccxt `feeChf != null` FALSE side: feeAmountChf == null → no separate venue fee leg; the mark-based
  // quote-spread plug still closes the cents (here base 905 vs quote 900 → 5 CHF residual surfaces as the plug).
  it('books a Binance Trade with feeAmountChf null → no venue fee leg, mark-based quote-spread plug closes cents', async () => {
    markMap.set(70, [{ created: new Date('2026-01-01'), priceChf: 90000 }]); // BTC mark → quote 0.01 × 90000 = 900
    mockBatch([
      exchangeTx({
        id: 21,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/BTC',
        side: 'buy',
        order: 'O-21',
        amount: 1000,
        amountChf: 905, // base 905 vs quote 900 → 5 CHF residual
        cost: 0.01,
        feeAmountChf: null, // feeChf == null → fee-leg branch skipped
      }),
    ]);
    await consumer.process();

    const spread = booked[0].legs.filter((l) => l.account.name?.includes('spread-Binance'));
    expect(spread).toHaveLength(1); // only the mark-based quote-spread plug, no separate venue fee leg
    expect(cents(booked[0].legs)).toBe(0);
  });

  // tradeSpec `quoteAmount !== 0` FALSE (Scrypt): cost 0 → quoteAmount 0 → quotePrice null on the plug quote leg.
  it('books a Scrypt Trade with cost 0 → quote leg amount 0 and priceChf null', async () => {
    mockBatch([
      exchangeTx({
        id: 22,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-22',
        amount: 1000,
        amountChf: 900,
        cost: 0, // quoteAmount 0 → quotePrice null
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const quote = booked[0].legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(quote.amount).toBe(-0); // quoteAmount = isBuy ? -cost : +cost = -0
    expect(quote.priceChf).toBeNull(); // quoteAmount 0 → no price
    expect(quote.amountChf).toBe(-900); // plug = −base
    expect(cents(booked[0].legs)).toBe(0);
  });

  // depositChf `tx.amount ?` FALSE side: amount 0 (falsy) with amountChf set → priceChf null, amountChf persisted.
  it('sets the Deposit priceChf null when amount is 0 (depositChf amount-falsy branch)', async () => {
    mockBatch([
      exchangeTx({ id: 23, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 0, amountChf: 0, txId: '0xzero' }),
    ]);
    await consumer.process();

    const asset = booked[0].legs.find((l) => l.account.name === 'Scrypt/EUR');
    expect(asset.priceChf).toBeNull(); // amount 0 → no price
    expect(asset.amountChf).toBe(0); // persisted amountChf
    expect(asset.needsMark).toBe(false);
  });

  // parseSymbol `!tx.side` sub-branch: a Trade with a VALID symbol but side null → undefined → SUSPENSE
  // (distinct from the 'no symbol/side' both-null and the 'malformed symbol' wrong-part-count cases).
  it('routes a Trade with a valid symbol but no side to SUSPENSE (parseSymbol !tx.side guard)', async () => {
    mockBatch([
      exchangeTx({ id: 24, type: ExchangeTxType.TRADE, symbol: 'USDT/CHF', side: null, amount: 100, amountChf: 90 }),
    ]);
    await consumer.process();

    expect(booked[0].legs.some((l) => l.account.name === 'SUSPENSE/Scrypt-trade-unattributed')).toBe(true);
    expect(cents(booked[0].legs)).toBe(0);
  });

  // processForward/buildSpec `tx.externalCreated ?? tx.created` (L79 preload + L125 bookingDate): a forward row with
  // externalCreated NULL → both the mark-preload window AND the booking/value date fall back to `created`.
  it('uses tx.created as the booking date when externalCreated is null (forward preload + buildSpec fallback)', async () => {
    const created = new Date('2026-03-15T10:00:00Z');
    mockBatch([
      exchangeTx({
        id: 30,
        type: ExchangeTxType.DEPOSIT,
        currency: 'EUR',
        amount: 100,
        amountChf: 95,
        txId: '0xcreated',
        externalCreated: null,
        created,
      }),
    ]);
    await consumer.process();

    expect(booked[0].bookingDate).toEqual(created); // externalCreated null → created fallback
    expect(booked[0].valueDate).toEqual(created);
    const asset = booked[0].legs.find((l) => l.account.name === 'Scrypt/EUR');
    expect(asset.amountChf).toBe(95);
  });

  // reconcileBooking `tx.externalCreated ?? tx.created` (L103, both operands): a content-change ok row with
  // externalCreated NULL → the reconcile mark-preload AND the recomputed spec use `created` as the booking date.
  it('reconciles a content-change row with null externalCreated using tx.created (reverse+rebook)', async () => {
    const created = new Date('2026-04-20T08:00:00Z');
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const reverseSpy = jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(false);
    const changed = exchangeTx({
      id: 31,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 100,
      amountChf: 95,
      txId: '0x',
      status: 'ok',
      externalCreated: null,
      created,
    });
    mockContentChange([], [changed]);
    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1);
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('31');
    expect(rebookSpy.mock.calls[0][0].bookingDate).toEqual(created); // externalCreated null → created
    expect(reverseSpy).not.toHaveBeenCalled();
  });

  // withdrawalSpec asset leg `chf.amountChf != null ? -chf.amountChf : undefined` UNDEFINED side (L174): a Withdrawal
  // whose amountChf is null AND whose asset has no mark → both legs carry amountChf undefined + needsMark.
  it('flags a Withdrawal needsMark with undefined amountChf when amountChf is null and no mark exists', async () => {
    accounts.set('Scrypt/ZZZ', account('Scrypt/ZZZ', AccountType.ASSET, 'ZZZ', 997)); // assetId set but no mark for 997
    mockBatch([
      exchangeTx({ id: 32, type: ExchangeTxType.WITHDRAWAL, currency: 'ZZZ', amount: 1000, amountChf: null }),
    ]);
    await consumer.process();

    const asset = booked[0].legs.find((l) => l.account.name === 'Scrypt/ZZZ');
    expect(asset.amount).toBe(-1000); // withdrawal reduces the exchange asset
    expect(asset.amountChf).toBeUndefined(); // amountChf null + no mark → undefined (not -null)
    expect(asset.needsMark).toBe(true);
    const counter = booked[0].legs.find((l) => l.account.name === 'SUSPENSE/Scrypt-deposit-unrouted/ZZZ');
    expect(counter.amountChf).toBeUndefined();
    expect(counter.needsMark).toBe(true);
  });

  // tradeSpec unattributed `tx.amountChf ?? 0` NULL side (L204): an unattributable trade (no symbol/side) whose
  // amountChf is null → the SUSPENSE legs both book at 0 (one +0, one −0, cents close).
  it('books the unattributed SUSPENSE legs at 0 when an unresolvable trade has null amountChf', async () => {
    mockBatch([
      exchangeTx({ id: 33, type: ExchangeTxType.TRADE, symbol: null, side: null, amount: 50, amountChf: null }),
    ]);
    await consumer.process();

    const legs = booked[0].legs.filter((l) => l.account.name === 'SUSPENSE/Scrypt-trade-unattributed');
    expect(legs).toHaveLength(2);
    expect(legs[0].amountChf).toBe(0); // tx.amountChf ?? 0 → 0
    expect(legs[1].amountChf).toBe(-0); // −0 (Object.is-sensitive)
    expect(cents(legs)).toBe(0);
  });

  // tradeSpec base leg NO baseChf + Scrypt plug reduce (L221 cond null, L222 cond undefined, L434 assetId-null
  // markValue undefined, L237 plug reduce `l.amountChf ?? 0`): a Scrypt trade whose BASE account has assetId null and
  // amountChf null → baseChf undefined → priceChf null, amountChf undefined, needsMark; the plug reduce treats the
  // base leg's undefined amountChf as 0.
  it('flags a Scrypt base leg needsMark (priceChf null, amountChf undefined) when the base account has no assetId', async () => {
    accounts.set('Scrypt/NOID', account('Scrypt/NOID', AccountType.ASSET, 'NOID')); // assetId undefined → no mark path
    mockBatch([
      exchangeTx({
        id: 34,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'NOID/CHF',
        side: 'buy',
        order: 'O-34',
        amount: 1000,
        amountChf: null, // → markValue(assetId null) → undefined → baseChf undefined
        cost: 905,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const base = booked[0].legs.find((l) => l.account.name === 'Scrypt/NOID');
    expect(base.priceChf).toBeNull(); // baseChf null → priceChf null (L221 cond null)
    expect(base.amountChf).toBeUndefined(); // baseChf null → amountChf undefined (L222 cond undefined)
    expect(base.needsMark).toBe(true);
    const quote = booked[0].legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(quote.amount).toBe(-905); // isBuy ? -cost : +cost
    expect(quote.amountChf).toBe(-0); // plug = −(base amountChf ?? 0) = −0 (L237 null side)
  });

  // tradeSpec `tx.amount || 1` fallback (L221 binary-expr): a Scrypt trade with amount 0 but a persisted amountChf →
  // baseChf != null so the priceChf division uses the `|| 1` denominator (price = abs(baseChf)/1), not a divide-by-0.
  it('uses the amount-|| -1 fallback for the base priceChf when tx.amount is 0', async () => {
    mockBatch([
      exchangeTx({
        id: 35,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-35',
        amount: 0, // falsy → `tx.amount || 1` denominator = 1
        amountChf: 900, // baseChf != null → priceChf = round(abs(900)/1, 8)
        cost: 905,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const base = booked[0].legs.find((l) => l.account.name === 'Scrypt/USDT');
    expect(base.amount).toBe(0); // isBuy ? +0
    expect(base.priceChf).toBe(900); // abs(900) / (0 || 1) = 900 (no NaN/Infinity)
    expect(base.amountChf).toBe(900);
    expect(base.needsMark).toBe(false);
  });

  // tradeSpec `tx.cost ?? 0` NULL side (L226): a Scrypt trade with cost null → cost 0 → quoteAmount 0, quotePrice null,
  // quote leg amountChf = plug (−base). Distinct from id 22 which sets cost: 0 (the left operand of `?? `).
  it('treats a null cost as 0 on a Scrypt Trade (quote amount −0, priceChf null, amountChf = −base)', async () => {
    mockBatch([
      exchangeTx({
        id: 36,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-36',
        amount: 1000,
        amountChf: 900,
        cost: null, // tx.cost ?? 0 → 0
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const quote = booked[0].legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(quote.amount).toBe(-0); // isBuy ? -(cost ?? 0) = -0
    expect(quote.priceChf).toBeNull(); // quoteAmount 0 → no price
    expect(quote.amountChf).toBe(-900); // plug = −base
    expect(cents(booked[0].legs)).toBe(0);
  });

  // tradeSpec ccxt quote `Math.abs(quoteChf)/Math.abs(cost || 1)` `cost || 1` fallback (L247): a Binance trade with
  // cost 0 but a quote MARK present → quoteChf = mark × |0| = 0 (a number, not null) → priceChf = abs(0)/(0||1) = 0,
  // NOT 0/0 = NaN. Asserting priceChf === 0 (finite) is load-bearing for the `|| 1` denominator.
  it('uses the cost-|| -1 fallback for the ccxt quote priceChf when cost is 0', async () => {
    markMap.set(70, [{ created: new Date('2026-01-01'), priceChf: 90000 }]); // BTC mark
    mockBatch([
      exchangeTx({
        id: 37,
        exchange: ExchangeName.BINANCE,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/BTC',
        side: 'buy',
        order: 'O-37',
        amount: 1000,
        amountChf: 900,
        cost: 0, // quoteChf = markValue(BTC, 0) = 0 (number); priceChf = abs(0)/(0||1) = 0
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const quote = booked[0].legs.find((l) => l.account.name === 'Binance/BTC');
    expect(quote.amount).toBe(-0); // isBuy ? -cost = -0
    expect(quote.priceChf).toBe(0); // finite 0 via the `|| 1` denominator (NOT NaN)
    expect(quote.needsMark).toBe(false); // quoteChf is 0, not null
    expect(cents(booked[0].legs)).toBe(0);
  });

  // tradeSpec no-order branch (L266 fill-index `?? 0`, L268 sourceId, L269 sourceType, L274 seq): a TRADE with NO
  // `order` → not in the (empty) fill-index map → seq 0, sourceType 'exchange_tx', sourceId = tx.id.
  it('books a Trade with no order under sourceType exchange_tx / sourceId tx.id / seq 0', async () => {
    mockBatch([
      exchangeTx({
        id: 38,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: null, // no order → no-order identifiers
        amount: 1000,
        amountChf: 900,
        cost: 905,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    expect(booked[0].sourceType).toBe('exchange_tx'); // no order → SOURCE_TYPE (L269)
    expect(booked[0].sourceId).toBe('38'); // no order → tx.id (L268)
    expect(booked[0].seq).toBe(0); // no order → seq 0 (L266 `?? 0` + L274)
    expect(cents(booked[0].legs)).toBe(0);
  });

  // hasBankRouteMatch `Math.abs(b.amount ?? 0)` NULL side (L355): a matched bank_tx with amount NULL is treated as 0
  // in the route-match filter. A second bank_tx with the matching amount makes `.some` true → TRANSIT route, proving
  // the null row was tolerated (not a throw) before the matching row was reached.
  it('tolerates a null bank_tx amount in the route-match filter and still routes via the matching bank_tx (R2)', async () => {
    jest
      .spyOn(bankTxRepo, 'find')
      .mockResolvedValue([
        Object.assign(new BankTx(), { amount: null }),
        Object.assign(new BankTx(), { amount: 1000 }),
      ] as BankTx[]);
    mockBatch([exchangeTx({ id: 39, type: ExchangeTxType.DEPOSIT, currency: 'EUR', amount: 1000, amountChf: 950 })]);
    await consumer.process();

    const legs = booked[0].legs;
    expect(legs.find((l) => l.account.name === 'TRANSIT/bank↔Scrypt/EUR')).toBeDefined(); // matched despite null row
    expect(legs.some((l) => l.account.name?.startsWith('SUSPENSE/'))).toBe(false);
    expect(cents(legs)).toBe(0);
  });
});
