import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { TradingOrderStatus } from 'src/subdomains/core/trading/enums';
import { Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { TradingOrderConsumer } from '../trading-order.consumer';

const USDT_ASSET_ID = 501; // assetIn (mark = 0.9)
const TOKEN_ASSET_ID = 502; // assetOut (mark = 1.05)

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

function tradingOrder(values: Record<string, unknown>): TradingOrder {
  return Object.assign(new TradingOrder(), {
    id: 1,
    updated: new Date('2026-06-07T00:00:00Z'),
    status: TradingOrderStatus.COMPLETE,
    txId: '0xabc',
    assetIn: { id: USDT_ASSET_ID, uniqueName: 'Ethereum/USDT' },
    assetOut: { id: TOKEN_ASSET_ID, uniqueName: 'Ethereum/TOKEN' },
    amountIn: 967,
    amountOut: 836,
    txFeeAmountChf: 1,
    swapFeeAmountChf: 2,
    profitChf: 3,
    ...values,
  });
}

describe('TradingOrderConsumer', () => {
  let consumer: TradingOrderConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let tradingOrderRepo: Repository<TradingOrder>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;

  const usdtWallet = account('Ethereum/USDT', AccountType.ASSET, 'USDT', USDT_ASSET_ID);
  const tokenWallet = account('Ethereum/TOKEN', AccountType.ASSET, 'TOKEN', TOKEN_ASSET_ID);

  // USDT mark = 0.9 → in CHF 967 × 0.9 = 870.30; TOKEN mark = 1.05 → out CHF 836 × 1.05 = 877.80
  const markMap = new Map([
    [USDT_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 0.9 }]],
    [TOKEN_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 1.05 }]],
  ]);

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    accounts = new Map();

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    tradingOrderRepo = createMock<Repository<TradingOrder>>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));

    jest.spyOn(accountService, 'findByAssetId').mockImplementation((assetId: number) => {
      const wallet = assetId === TOKEN_ASSET_ID ? tokenWallet : usdtWallet;
      return Promise.resolve(wallet);
    });
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestUtil.provideConfig(),
        TradingOrderConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(TradingOrder), useValue: tradingOrderRepo },
      ],
    }).compile();

    consumer = module.get<TradingOrderConsumer>(TradingOrderConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  const mockBatch = (rows: TradingOrder[]) => jest.spyOn(tradingOrderRepo, 'find').mockResolvedValue(rows);
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §4.9 — full arbitrage swap: ASSET out (markOut) / ASSET in (markIn) + network-fee + spread-DfxDex + INCOME/
  // trading + spread-arbitrage plug for the mark residual. Σ CHF = 0.
  it('books an arbitrage swap with mark legs, persisted fee/profit legs, and a spread-arbitrage plug', async () => {
    mockBatch([tradingOrder({ id: 10 })]);
    await consumer.process();

    expect(booked).toHaveLength(1);
    const tx = booked[0];
    expect(tx.sourceType).toBe('trading_order');
    expect(tx.sourceId).toBe('10');

    const out = leg(tx, 'Ethereum/TOKEN');
    const inLeg = leg(tx, 'Ethereum/USDT');
    expect(out.amount).toBe(836);
    expect(out.amountChf).toBe(877.8); // 836 × 1.05
    expect(inLeg.amount).toBe(-967);
    expect(inLeg.amountChf).toBe(-870.3); // 967 × 0.9

    expect(leg(tx, 'EXPENSE/network-fee').amountChf).toBe(1); // txFeeAmountChf
    expect(leg(tx, 'EXPENSE/spread-DfxDex').amountChf).toBe(2); // swapFeeAmountChf → swap venue spread
    expect(leg(tx, 'INCOME/trading').amountChf).toBe(-3); // profitChf (Cr)

    // residual = −(877.8 − 870.3 + 1 + 2 − 3) = −7.5 → < 0 → EXPENSE/spread-arbitrage
    expect(leg(tx, 'EXPENSE/spread-arbitrage').amountChf).toBe(-7.5);
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.9 — residual > 0 → INCOME/spread-arbitrage (sign-aware plug)
  it('books an INCOME/spread-arbitrage plug when the mark residual is positive', async () => {
    // out CHF 877.80, in CHF 870.30, no fees/profit → residual = −(877.8 − 870.3) = −7.5 (EXPENSE);
    // make out smaller than in so residual is positive
    mockBatch([
      tradingOrder({
        id: 11,
        amountOut: 800, // 800 × 1.05 = 840
        amountIn: 967, // 967 × 0.9 = 870.30
        txFeeAmountChf: 0,
        swapFeeAmountChf: 0,
        profitChf: 0,
      }),
    ]);
    await consumer.process();
    const tx = booked[0];
    // residual = −(840 − 870.30 + 0) = +30.30 → INCOME/spread-arbitrage
    expect(leg(tx, 'INCOME/spread-arbitrage').amountChf).toBe(30.3);
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.9 Major R2-5 null-strategy: nullable persisted fee/profit fields → leg entirely omitted (no ?? 0)
  it('omits a fee/profit leg when its persisted field is null (no ?? 0 default)', async () => {
    mockBatch([tradingOrder({ id: 12, txFeeAmountChf: null, swapFeeAmountChf: null, profitChf: null })]);
    await consumer.process();
    const tx = booked[0];
    expect(leg(tx, 'EXPENSE/network-fee')).toBeUndefined();
    expect(leg(tx, 'EXPENSE/spread-DfxDex')).toBeUndefined();
    expect(leg(tx, 'INCOME/trading')).toBeUndefined();
    // the whole valuation residual now lands in the arbitrage plug; Σ CHF still 0
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.9 — a zero-valued profit still books an INCOME/trading leg (0 != null), Σ CHF unaffected
  it('books a profitChf=0 leg (0 is a real value, not absent)', async () => {
    mockBatch([tradingOrder({ id: 13, profitChf: 0 })]);
    await consumer.process();
    expect(leg(booked[0], 'INCOME/trading')).toBeDefined();
    expect(leg(booked[0], 'INCOME/trading').amountChf).toBe(-0);
  });

  // §4.9 Blocker R1-3: the structural valuation spread is NEVER forced into ROUNDING — it goes to spread-arbitrage.
  // A large mark residual (> 2 cent cap) would throw on the rounding cap if mis-routed to ROUNDING.
  it('routes a >2-cent mark residual to spread-arbitrage, never ROUNDING (Blocker R1-3)', async () => {
    mockBatch([tradingOrder({ id: 14 })]); // residual −7.50 = 750 cents >> 2-cent cap
    await consumer.process();
    const plug = leg(booked[0], 'EXPENSE/spread-arbitrage');
    expect(plug).toBeDefined();
    expect(Math.abs(plug.amountChf)).toBeGreaterThan(0.02); // well above the ROUNDING cap
    expect(leg(booked[0], 'ROUNDING')).toBeUndefined();
  });

  // §4.9 appendArbitragePlug sub-cent branch (line 127): when Σ legs nets to within the rounding tolerance, NO
  // spread-arbitrage plug is appended (the booking-service ROUNDING leg closes the sub-cent rest). Construct a swap
  // where out CHF == in CHF + fees exactly so the residual is 0.
  it('appends NO spread-arbitrage plug when the mark residual is sub-cent', async () => {
    // out 900 × 1.05 = 945; in 1050 × 0.9 = 945 → Σ asset = 0; no fees/profit → residual 0 → sub-cent → no plug.
    mockBatch([
      tradingOrder({
        id: 19,
        amountOut: 900,
        amountIn: 1050,
        txFeeAmountChf: null,
        swapFeeAmountChf: null,
        profitChf: null,
      }),
    ]);
    await consumer.process();
    const tx = booked[0];
    expect(leg(tx, 'Ethereum/TOKEN').amountChf).toBe(945); // 900 × 1.05
    expect(leg(tx, 'Ethereum/USDT').amountChf).toBe(-945); // 1050 × 0.9
    expect(leg(tx, 'EXPENSE/spread-arbitrage')).toBeUndefined(); // residual 0 → sub-cent → no plug
    expect(leg(tx, 'INCOME/spread-arbitrage')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.9 missing mark → ASSET leg needsMark, plug stays open (no silent plug without a mark)
  it('flags the ASSET leg needsMark and skips the plug when a mark is missing', async () => {
    jest.spyOn(markService, 'preload').mockResolvedValue(
      new LedgerMarkCache(new Map([[USDT_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 0.9 }]]])), // TOKEN missing
    );
    mockBatch([tradingOrder({ id: 15 })]);
    await consumer.process();
    const tx = booked[0];
    expect(leg(tx, 'Ethereum/TOKEN').needsMark).toBe(true);
    expect(leg(tx, 'Ethereum/TOKEN').amountChf).toBeUndefined();
    expect(leg(tx, 'EXPENSE/spread-arbitrage')).toBeUndefined(); // no silent plug without a mark
    expect(leg(tx, 'INCOME/spread-arbitrage')).toBeUndefined();
  });

  // §4.9 assetAccount throw (line 163): an asset with no CoA ledger account → throws → failure-isolation (watermark
  // unchanged, nothing booked).
  it('stops the batch and leaves the watermark when an asset has no ledger account (CoA bootstrap missing)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(undefined); // no CoA account for any asset
    mockBatch([tradingOrder({ id: 20 })]);

    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing
  });

  // §4.9 invalid swap: amountIn/amountOut null → skip (not booked)
  it('skips an order with a null swap amount', async () => {
    mockBatch([tradingOrder({ id: 16, amountOut: null })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4.9 idempotency: an already-booked order (nextSeq > 0) is not re-booked. Adversarial dedup: re-running the
  // consumer over the same trading_order must NOT double-book the swap.
  it('is idempotent: skips an already-booked order (re-run, nextSeq > 0)', async () => {
    nextSeqValue = 1;
    mockBatch([tradingOrder({ id: 17 })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([tradingOrder({ id: 18 })]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(18);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4-header failure-isolation (catch in the batch loop): a booking error stops the batch, logs, and leaves the
  // watermark unchanged so the row is retried next run. The first row books; the second throws → watermark = first id.
  it('stops the batch on a booking error and advances the watermark only to the last success (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    const errSpy = jest.spyOn(consumer['logger'], 'error');
    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      if (input.sourceId === '41') return Promise.reject(new Error('db down'));
      booked.push(input);
      return Promise.resolve({} as any);
    });
    mockBatch([tradingOrder({ id: 40 }), tradingOrder({ id: 41 })]);

    await consumer.process();

    expect(booked.map((b) => b.sourceId)).toEqual(['40']); // only the first booked
    expect(errSpy).toHaveBeenCalledWith('Failed to book trading_order 41', expect.any(Error));
    expect(JSON.parse(setSpy.mock.calls[0][1]).lastProcessedId).toBe(40); // NOT 41 → retry next run
  });
});
