import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExchangeTx, ExchangeTxType } from 'src/integration/exchange/entities/exchange-tx.entity';
import { ExchangeName } from 'src/integration/exchange/enums/exchange.enum';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { Util } from 'src/shared/utils/util';
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
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(undefined); // B5: no bridge by default (tests opt in)
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
      // B4: the fill-index preload query is status-AGNOSTIC (where: { type, order } — no status filter), so a fill that
      // flipped away from 'ok' keeps its id-ordered rank slot (survivors never shift). Faithfully honour opts.where.status
      // so the mock returns exactly what the query asks: post-fix (no status) → all fills; a reverted status='ok' filter
      // → only the still-ok ones (which would shift the survivors, failing the B4 test).
      if (opts?.where?.order != null) {
        const trades = [...forward, ...changed].filter((r) => r.type === ExchangeTxType.TRADE);
        return Promise.resolve(
          opts.where.status != null ? trades.filter((r) => r.status === opts.where.status) : trades,
        );
      }
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

    const legs = booked[0].legs;
    // no guessing: only the deposit's own 2 legs — no extra leg synthesised to close a specific ambiguous post
    expect(legs).toHaveLength(2);
    const asset = legs.find((l) => l.account.name === 'Scrypt/EUR');
    expect(asset.amount).toBe(1000);
    expect(asset.amountChf).toBe(950);
    const suspenseLegs = legs.filter((l) => l.account.name === 'SUSPENSE/untracked-bank-Raiffeisen-EUR');
    expect(suspenseLegs).toHaveLength(1); // one deposit-worth counter leg, NOT a per-post closing leg
    expect(suspenseLegs[0].amountChf).toBe(-950); // one deposit's value → both open +1000 posts remain, no sweep
    expect(cents(legs)).toBe(0); // balanced
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
    expect(spread[0].amountChf).toBe(-5); // the persisted feeAmountChf (rebate) is the exact spread-leg value
    // quote leg is the plug; no extra mark-based quote-spread leg
    const quote = legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(quote).toBeDefined();
    expect(cents(legs)).toBe(0); // closes without ROUNDING throw
    expect(booked[0].sourceType).toBe('ExchangeTrade');
    expect(booked[0].sourceId).toBe('Scrypt:O-1'); // B3: exchange-prefixed composite sourceId
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
    expect(booked[0].legs.some((l) => l.account.name === 'EXPENSE/spread-Scrypt' && l.amountChf === 5)).toBe(true);
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
    expect(booked.every((b) => b.sourceId === 'Scrypt:O-9')).toBe(true); // B3: exchange-prefixed composite sourceId
  });

  // the watermark does not persist in this spec (getObj → undefined, set → no-op), so a naive second process()
  // re-selects the same rows. The real backstop against double-booking is the DB UNIQUE(sourceType, sourceId, seq)
  // constraint + the forward loop's failure-isolation: here bookTx enforces UNIQUE, and buildFillIndexMap re-derives
  // the SAME 0-based ranks, so the re-run's identical keys collide and no second booking lands. If fill_index were NOT
  // reproduced (e.g. run 2 produced seq 2,3) booked.length would be 4; the `=== 2` assertion is what discriminates.
  it('is re-run idempotent: a second run reproduces the same fill_index and does not double-book (UNIQUE backstop)', async () => {
    const keys = new Set<string>();
    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      const key = `${input.sourceType}:${input.sourceId}:${input.seq}`;
      if (keys.has(key)) return Promise.reject(new Error('duplicate ledger_tx key (UNIQUE)')); // DB backstop
      keys.add(key);
      booked.push(input);
      return Promise.resolve({} as any);
    });
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
    await consumer.process(); // re-run: forward re-selects, buildFillIndexMap re-derives the same 0-based ranks

    // no double-booking: the re-run's identical (sourceId, seq) keys collided with the UNIQUE backstop → still 2 txs
    expect(booked).toHaveLength(2);
    // deterministic, reproduced fill_index
    expect(booked.map((b) => b.seq).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(booked.every((b) => b.sourceType === 'ExchangeTrade' && b.sourceId === 'Scrypt:O-9')).toBe(true); // B3
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

    // trade reversal targets sourceType=ExchangeTrade, sourceId=`${exchange}:${order}` (B3), seq=fill-index (0 for the
    // only fill of O-7)
    expect(reverseSpy).toHaveBeenCalledWith('ExchangeTrade', 'Scrypt:O-7', 0);
  });

  // Major B4: an ok→failed flip of a SIBLING fill must NOT shift the survivors' fill-index seqs. Order O-40 has three
  // fills [id 10, 20, 30]; fill 20 flipped to failed. The ranking is status-agnostic (over ALL fills of the order), so
  // fill 30 keeps its id-ordered slot seq 2 — NOT shifted down to 1 by fill 20 dropping out of the 'ok' set (the pre-fix
  // corruption). The survivor's correction targets seq 2. The faithful preload mock honours opts.where.status, so a
  // reverted status='ok' filter would return only [10, 30] → rank fill 30 at seq 1 → this test would fail.
  it('keeps a survivor fill index stable when a sibling fill flips ok→failed (no seq shift, B4)', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(true);
    const fill = (id: number, status = 'ok') =>
      exchangeTx({
        id,
        type: ExchangeTxType.TRADE,
        symbol: 'USDT/CHF',
        side: 'buy',
        order: 'O-40',
        amount: 100,
        amountChf: 90,
        cost: 90,
        status,
      });
    const f10 = fill(10);
    const f20 = fill(20, 'failed'); // sibling flipped away from 'ok'
    const f30 = fill(30); // survivor being reconciled by the content-change scan

    jest.spyOn(exchangeTxRepo, 'find').mockImplementation((opts: any) => {
      if (opts?.where?.updated != null) return Promise.resolve([f30]); // content-change scan re-selects the survivor
      if (opts?.where?.order != null) {
        const all = [f10, f20, f30]; // ALL fills of O-40, any status
        return Promise.resolve(opts.where.status != null ? all.filter((r) => r.status === opts.where.status) : all);
      }
      return Promise.resolve([]); // forward id-scan empty
    });

    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1);
    expect(rebookSpy.mock.calls[0][0].seq).toBe(2); // fill 30 keeps rank 2 (status-agnostic) — NOT shifted to 1
    expect(rebookSpy.mock.calls[0][0].sourceId).toBe('Scrypt:O-40');
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

  // --- C1: LATE-SETTLING FORWARD COVERAGE (content-change scan) --- //

  // C1: an exchange_tx that becomes status='ok' only AFTER the forward id-watermark advanced over it is
  // forward-unreachable (the forward scan filters status='ok'). The status-agnostic content-change scan must
  // forward-book it: reconcileBooking finds nothing active to correct and no tx ever booked at the seq → bookTx.
  it('forward-books a late-settling ok exchange_tx surfaced only by the content-change scan (C1)', async () => {
    const rebookSpy = jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false); // nothing active
    jest.spyOn(bookingService, 'hasAnyTxAt').mockResolvedValue(false); // never booked at this seq
    const late = exchangeTx({
      id: 40,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 100,
      amountChf: 95,
      txId: '0x',
      status: 'ok',
    });
    mockContentChange([], [late]);
    await consumer.process();

    expect(rebookSpy).toHaveBeenCalledTimes(1); // tried to correct → nothing active
    expect(booked.map((b) => b.sourceId)).toEqual(['40']); // then forward-booked because no tx ever existed at the seq
  });

  // C1: an active-unchanged (or flat-reversed) row in the content-change scan must NOT be re-booked — hasAnyTxAt guards
  // the bookTx so no UNIQUE collision on the append-only original seq.
  it('does NOT forward-book an ok exchange_tx that already has a tx at its seq (hasAnyTxAt guard)', async () => {
    jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false); // unchanged & active
    jest.spyOn(bookingService, 'hasAnyTxAt').mockResolvedValue(true); // a tx already exists at this seq
    const unchanged = exchangeTx({
      id: 41,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 100,
      amountChf: 95,
      txId: '0x',
      status: 'ok',
    });
    mockContentChange([], [unchanged]);
    await consumer.process();

    expect(booked).toHaveLength(0); // hasAnyTxAt true → no forward book (would collide with the existing seq)
  });

  // C1 two-run integration: run 1 books the ok row 61 and advances the id-watermark OVER the still-pending id 60; row
  // 60 flips to ok; run 2's forward id-scan (id > 61) no longer returns it, but the content-change scan forward-books it.
  it('forward-books an exchange_tx that flipped to ok AFTER the id-watermark advanced over it (C1, two runs)', async () => {
    const bookedKeys = new Set<string>();
    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      bookedKeys.add(`${input.sourceType}:${input.sourceId}:${input.seq}`);
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false); // nothing active to correct
    jest.spyOn(bookingService, 'reverseActiveIfBooked').mockResolvedValue(false);
    jest
      .spyOn(bookingService, 'hasAnyTxAt')
      .mockImplementation((st: string, sid: string, seq: number) =>
        Promise.resolve(bookedKeys.has(`${st}:${sid}:${seq}`)),
      );

    const settled = exchangeTx({
      id: 61,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 100,
      amountChf: 95,
      txId: '0x',
      status: 'ok',
    });
    const lateBefore = exchangeTx({
      id: 60,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 50,
      amountChf: 47,
      txId: '0x',
      status: 'pending',
    });
    const lateAfter = exchangeTx({
      id: 60,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 50,
      amountChf: 47,
      txId: '0x',
      status: 'ok',
    });

    // RUN 1: forward books ok row 61; the content-change scan sees the still-pending row 60 (flat-reverse no-op, never
    // booked) and the already-booked row 61 (hasAnyTxAt true → no re-book).
    mockContentChange([settled], [lateBefore, settled]);
    await consumer.process();
    expect(booked.map((b) => b.sourceId)).toEqual(['61']); // only row 61 booked (row 60 still pending)

    // RUN 2: row 60 flipped to ok. Forward (id > 61) returns nothing; the content-change scan forward-books row 60.
    mockContentChange([], [lateAfter]);
    await consumer.process();
    expect(booked.map((b) => b.sourceId).sort()).toEqual(['60', '61']); // row 60 finally booked on the second run
  });

  // §6.3 covered-by-cutover-opening guard: an exchange_tx already 'ok' (settled) at the cutover snapshot is in the
  // aggregate ASSET opening; a post-cutover `updated` bump re-selects it in the content-change scan, but its seq0 must
  // NOT be re-booked (double-count). The guard keys on the exchange_tx row id, not the composite trade sourceId. Without
  // the guard this row WOULD forward-book (reverseAndRebookIfChanged found nothing active + hasAnyTxAt false).
  it('does NOT re-book a pre-cutover-settled exchange_tx re-selected by the content-change scan (covered)', async () => {
    jest.spyOn(bookingService, 'reverseAndRebookIfChanged').mockResolvedValue(false); // nothing active to correct
    jest.spyOn(bookingService, 'hasAnyTxAt').mockResolvedValue(false); // no tx at the seq → would book if not covered
    jest
      .spyOn(settingService, 'getObj')
      .mockImplementation((key: string) =>
        Promise.resolve(key === 'ledgerCutoverBoundary.exchange_tx' ? { boundaryId: 100, holeIds: [] } : undefined),
      );
    const covered = exchangeTx({
      id: 42,
      type: ExchangeTxType.DEPOSIT,
      currency: 'EUR',
      amount: 100,
      amountChf: 95,
      txId: '0x',
      status: 'ok',
    });
    mockContentChange([], [covered]);
    await consumer.process();

    expect(booked).toHaveLength(0); // id 42 <= boundary 100, not a hole → covered → no fresh seq0
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
  // Major B5 — no mark ANYWHERE for the ccxt quote asset: the mixed trade (valued base leg + unvalued quote leg) cannot
  // balance and the bridge finds no mark → the row DEFERS (nothing booked, watermark unchanged), never a silent plug.
  it('defers a ccxt trade when the quote mark is missing everywhere (mixed tx, B5)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
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

    expect(booked[0]).toBeUndefined(); // deferred: unbalanceable mixed trade, no quote bridge
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
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

  // F4: a Scrypt trade whose base leg is UNVALUED (amountChf null AND no historical mark) but has a youngest mark → the
  // base is bridged BEFORE the quote plug is formed, so the quote plug reflects the REAL base value (not the phantom 0
  // that would misvalue the quote custody account by the full base). The quote plug inherits needsMark (provisional
  // basis) → the mark-to-market job re-marks the quote account once the base is re-marked.
  it('bridges an unvalued Scrypt base leg before the quote plug and flags the plug needsMark (F4)', async () => {
    accounts.set('Scrypt/XYZ', account('Scrypt/XYZ', AccountType.ASSET, 'XYZ', 998)); // no historical mark for 998
    jest.spyOn(markService, 'getLatestMark').mockResolvedValue(0.9); // youngest available mark for the base asset
    mockBatch([
      exchangeTx({
        id: 25,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'XYZ/CHF',
        side: 'buy',
        order: 'O-25',
        amount: 1000,
        amountChf: null, // base unvalued (no persisted CHF) and 998 has no mark at the booking date
        cost: 905,
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    const legs = booked[0].legs;
    const base = legs.find((l) => l.account.name === 'Scrypt/XYZ');
    const quote = legs.find((l) => l.account.name === 'Scrypt/CHF');
    expect(base.amountChf).toBe(900); // bridged: 0.9 × 1000 (NOT undefined / a phantom 0)
    expect(base.needsMark).toBe(true); // stays true → mark-to-market re-marks the base later
    expect(quote.amountChf).toBe(-900); // the quote plug reflects the REAL bridged base value, not −0
    expect(quote.needsMark).toBe(true); // base was bridged → the quote plug is provisional → re-marked too
    expect(cents(legs)).toBe(0);
  });

  // F4: a Scrypt trade whose base is feedless (no mark anywhere) AND carries a market spread → the mixed set (valued
  // spread leg + unvalued base) cannot balance and the bridge finds nothing → the row DEFERS instead of silently
  // plugging the full base value into the quote custody leg.
  it('defers a Scrypt trade when the base is feedless and there is a market spread (F4)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    accounts.set('Scrypt/XYZ', account('Scrypt/XYZ', AccountType.ASSET, 'XYZ', 998)); // no mark; getLatestMark undefined
    mockBatch([
      exchangeTx({
        id: 26,
        exchange: ExchangeName.SCRYPT,
        type: ExchangeTxType.TRADE,
        symbol: 'XYZ/CHF',
        side: 'buy',
        order: 'O-26',
        amount: 1000,
        amountChf: null,
        cost: 905,
        feeAmountChf: 5, // a market spread → the valued spread leg makes the unvalued-base set mixed-unbalanceable
      }),
    ]);
    await consumer.process();

    expect(booked[0]).toBeUndefined(); // deferred (feedless base + spread → mixed, no bridge)
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced
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

  // reconcileBooking `tx.externalCreated ?? tx.created` (both operands): a content-change ok row with externalCreated
  // NULL → the recomputed spec uses `created` as the booking date, and the reconcile mark-preload uses a
  // daysBefore(2, created) lookback lower bound (so getMarkAt finds the latest mark at-or-before the row timestamp).
  it('reconciles a content-change row with null externalCreated using tx.created (reverse+rebook)', async () => {
    const created = new Date('2026-04-20T08:00:00Z');
    const preloadSpy = jest.spyOn(markService, 'preload');
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
    // forward batch empty → the only preload call is the reconcile one: [daysBefore(2, created), created]
    const lastPreload = preloadSpy.mock.calls[preloadSpy.mock.calls.length - 1];
    expect(lastPreload[0]).toEqual(Util.daysBefore(2, created));
    expect(lastPreload[1]).toEqual(created);
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
  // A4 — a settled ('ok') trade with NO cost (quote amount) is a data error: `cost ?? 0` would book a zero-quote trade
  // (silently). Fail loud instead → failure-isolation leaves the watermark and retries.
  it('fails loud on an ok Trade with a null cost (no silent zero-quote, A4)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
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
        cost: null, // 'ok' trade with no cost → A4 throws (never a silent 0-quote)
        feeAmountChf: 0,
      }),
    ]);
    await consumer.process();

    expect(booked[0]).toBeUndefined(); // nothing booked (fail-loud)
    expect(setSpy).not.toHaveBeenCalled(); // watermark NOT advanced → retry
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
