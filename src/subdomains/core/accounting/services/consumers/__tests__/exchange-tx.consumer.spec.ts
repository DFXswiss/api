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
      // the fill-index preload re-queries with type=Trade — return the same trade rows for ranking
      if (opts?.where?.order != null) return Promise.resolve(rows.filter((r) => r.type === ExchangeTxType.TRADE));
      return Promise.resolve(rows);
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
});
