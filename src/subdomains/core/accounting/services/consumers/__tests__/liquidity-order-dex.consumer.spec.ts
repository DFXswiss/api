import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { TestUtil } from 'src/shared/utils/test.util';
import {
  LiquidityOrder,
  LiquidityOrderContext,
  LiquidityOrderType,
} from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { In, Not, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../../entities/ledger-account.entity';
import { createCustomLedgerAccount } from '../../../entities/__mocks__/ledger-account.entity.mock';
import { LedgerAccountService } from '../../ledger-account.service';
import { LedgerBookingService, LedgerLegInput, LedgerTxInput } from '../../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../../ledger-mark.service';
import { LiquidityOrderDexConsumer } from '../liquidity-order-dex.consumer';

const USDC_ASSET_ID = 601; // swapAsset (mark = 0.95)
const EURC_ASSET_ID = 602; // targetAsset (mark = 1.05)
const ETH_ASSET_ID = 603; // distinct gas fee asset (mark = 2000)

function account(name: string, type: AccountType, currency: string, assetId?: number): LedgerAccount {
  return createCustomLedgerAccount({ id: Math.floor(Math.random() * 1e6), name, type, currency, assetId } as any);
}

function liquidityOrder(values: Record<string, unknown>): LiquidityOrder {
  return Object.assign(new LiquidityOrder(), {
    id: 1,
    updated: new Date('2026-06-07T00:00:00Z'),
    context: LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
    type: LiquidityOrderType.PURCHASE,
    correlationId: '123177',
    txId: '0xdead',
    targetAsset: { id: EURC_ASSET_ID, uniqueName: 'Ethereum/EURC' },
    targetAmount: 1000,
    swapAsset: { id: USDC_ASSET_ID, uniqueName: 'Ethereum/USDC' },
    swapAmount: 1050,
    ...values,
  });
}

describe('LiquidityOrderDexConsumer', () => {
  let consumer: LiquidityOrderDexConsumer;
  let bookingService: LedgerBookingService;
  let accountService: LedgerAccountService;
  let markService: LedgerMarkService;
  let settingService: SettingService;
  let liquidityOrderRepo: Repository<LiquidityOrder>;

  let booked: LedgerTxInput[];
  let accounts: Map<string, LedgerAccount>;
  let nextSeqValue: number;

  const usdcWallet = account('Ethereum/USDC', AccountType.ASSET, 'USDC', USDC_ASSET_ID);
  const eurcWallet = account('Ethereum/EURC', AccountType.ASSET, 'EURC', EURC_ASSET_ID);
  const ethWallet = account('Ethereum/ETH', AccountType.ASSET, 'ETH', ETH_ASSET_ID);

  // EURC mark = 1.05 (target); USDC mark = 0.95 (swap); ETH mark = 2000 (gas fee)
  const markMap = new Map([
    [EURC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 1.05 }]],
    [USDC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]],
    [ETH_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 2000 }]],
  ]);

  beforeEach(async () => {
    booked = [];
    nextSeqValue = 0;
    accounts = new Map();

    bookingService = createMock<LedgerBookingService>();
    accountService = createMock<LedgerAccountService>();
    markService = createMock<LedgerMarkService>();
    settingService = createMock<SettingService>();
    liquidityOrderRepo = createMock<Repository<LiquidityOrder>>();

    jest.spyOn(bookingService, 'bookTx').mockImplementation((input: LedgerTxInput) => {
      booked.push(input);
      return Promise.resolve({} as any);
    });
    jest.spyOn(bookingService, 'nextSeq').mockImplementation(() => Promise.resolve(nextSeqValue));

    jest.spyOn(accountService, 'findByAssetId').mockImplementation((assetId: number) => {
      const wallet = assetId === EURC_ASSET_ID ? eurcWallet : assetId === ETH_ASSET_ID ? ethWallet : usdcWallet;
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
        LiquidityOrderDexConsumer,
        { provide: LedgerBookingService, useValue: bookingService },
        { provide: LedgerAccountService, useValue: accountService },
        { provide: LedgerMarkService, useValue: markService },
        { provide: SettingService, useValue: settingService },
        { provide: getRepositoryToken(LiquidityOrder), useValue: liquidityOrderRepo },
      ],
    }).compile();

    consumer = module.get<LiquidityOrderDexConsumer>(LiquidityOrderDexConsumer);
  });

  const cents = (legs: LedgerLegInput[]) => legs.reduce((s, l) => s + Math.round((l.amountChf ?? 0) * 100), 0);
  const mockBatch = (rows: LiquidityOrder[]) => jest.spyOn(liquidityOrderRepo, 'find').mockResolvedValue(rows);
  const leg = (tx: LedgerTxInput, name: string) => tx.legs.find((l) => l.account.name === name);

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  // §4.8a — DfxDex swap: Dr ASSET/target (mark) / Cr ASSET/swap (mark) + spread-DfxDex plug (no fee). Σ CHF = 0.
  it('books a DfxDex swap with two mark legs and a spread-DfxDex plug', async () => {
    mockBatch([liquidityOrder({ id: 10 })]);
    await consumer.process();

    expect(booked).toHaveLength(1);
    const tx = booked[0];
    expect(tx.sourceType).toBe('liquidity_order');
    expect(tx.sourceId).toBe('LiquidityManagement:123177'); // '<context>:<correlationId>' (Minor R6-8)

    const target = leg(tx, 'Ethereum/EURC');
    const swap = leg(tx, 'Ethereum/USDC');
    expect(target.amount).toBe(1000);
    expect(target.amountChf).toBe(1050); // 1000 × 1.05
    expect(swap.amount).toBe(-1050);
    expect(swap.amountChf).toBe(-997.5); // 1050 × 0.95
    // residual = −(1050 − 997.5) = −52.5 → EXPENSE/spread-DfxDex (NOT ROUNDING, Blocker R5-1)
    expect(leg(tx, 'EXPENSE/spread-DfxDex').amountChf).toBe(-52.5);
    expect(leg(tx, 'ROUNDING')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.8a Major R7-1 case 3: fee asset is a THIRD asset (gas) → its own Cr ASSET/{feeAsset} native leg +
  // EXPENSE/network-fee CHF leg; the native fee leaves ASSET/ETH, NOT the swap/target asset
  it('books a third-asset (gas) fee against ASSET/{feeAsset} + EXPENSE/network-fee (Major R7-1 case 3)', async () => {
    mockBatch([
      liquidityOrder({ id: 11, feeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' }, feeAmount: 0.01 }),
    ]);
    await consumer.process();

    const tx = booked[0];
    expect(leg(tx, 'Ethereum/ETH').amount).toBe(-0.01); // native gas leg against ETH
    expect(leg(tx, 'Ethereum/ETH').amountChf).toBe(-20); // 0.01 × 2000
    expect(leg(tx, 'EXPENSE/network-fee').amountChf).toBe(20); // mark × feeAmount, CHF-only
    expect(leg(tx, 'Ethereum/EURC').amount).toBe(1000); // target leg unchanged
    expect(leg(tx, 'Ethereum/USDC').amount).toBe(-1050); // swap leg unchanged
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.8a Major R7-1 case 1: feeAsset == swapAsset → folds into the existing Cr ASSET/swap leg (no own leg)
  it('folds a swap-asset fee into the existing Cr ASSET/swap leg (Major R7-1 case 1)', async () => {
    mockBatch([liquidityOrder({ id: 12, feeAsset: { id: USDC_ASSET_ID, uniqueName: 'Ethereum/USDC' }, feeAmount: 5 })]);
    await consumer.process();

    const tx = booked[0];
    const swapLegs = tx.legs.filter((l) => l.account.name === 'Ethereum/USDC');
    expect(swapLegs).toHaveLength(1); // single combined leg, no separate fee leg
    expect(swapLegs[0].amount).toBe(-1055); // −1050 − 5 folded native
    expect(leg(tx, 'EXPENSE/network-fee').amountChf).toBe(4.75); // 5 × 0.95
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.8a Major R7-1 case 2: feeAsset == targetAsset → reduces the existing Dr ASSET/target leg (fee leaves target)
  it('reduces the Dr ASSET/target leg by a target-asset fee (Major R7-1 case 2)', async () => {
    mockBatch([liquidityOrder({ id: 13, feeAsset: { id: EURC_ASSET_ID, uniqueName: 'Ethereum/EURC' }, feeAmount: 4 })]);
    await consumer.process();

    const tx = booked[0];
    const targetLegs = tx.legs.filter((l) => l.account.name === 'Ethereum/EURC');
    expect(targetLegs).toHaveLength(1);
    expect(targetLegs[0].amount).toBe(996); // 1000 − 4 (fee leaves the target)
    expect(leg(tx, 'EXPENSE/network-fee').amountChf).toBe(4.2); // 4 × 1.05
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.8a Major R2-5 null-strategy: no feeAsset/feeAmount → no fee leg at all
  it('books no fee leg when feeAsset/feeAmount are absent (Null-Strategie)', async () => {
    mockBatch([liquidityOrder({ id: 14, feeAsset: undefined, feeAmount: undefined })]);
    await consumer.process();
    expect(leg(booked[0], 'EXPENSE/network-fee')).toBeUndefined();
  });

  // §4.8a missing mark → ASSET leg needsMark, plug skipped (no silent plug without a mark)
  it('flags the ASSET leg needsMark and skips the spread plug when a mark is missing', async () => {
    jest.spyOn(markService, 'preload').mockResolvedValue(
      new LedgerMarkCache(new Map([[USDC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]]])), // EURC missing
    );
    mockBatch([liquidityOrder({ id: 15 })]);
    await consumer.process();
    const tx = booked[0];
    expect(leg(tx, 'Ethereum/EURC').needsMark).toBe(true);
    expect(leg(tx, 'Ethereum/EURC').amountChf).toBeUndefined();
    expect(leg(tx, 'EXPENSE/spread-DfxDex')).toBeUndefined();
    expect(leg(tx, 'INCOME/spread-DfxDex')).toBeUndefined();
  });

  // §4.8a invalid swap (target/swap amount null) → skip
  it('skips an order with a null target/swap amount', async () => {
    mockBatch([liquidityOrder({ id: 16, targetAmount: null })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4.8a idempotency / adversarial dedup: re-running over the same '<context>:<correlationId>' key must NOT
  // double-book the swap — uniqueness rests on the ledger UNIQUE(sourceType,sourceId,seq) (Minor R6-8)
  it('is idempotent on the <context>:<correlationId> key (re-run, nextSeq > 0)', async () => {
    nextSeqValue = 1;
    mockBatch([liquidityOrder({ id: 17 })]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });

  // §4.8a DEDUP query: the query excludes Reservation rows and txId IS NULL — the consumer never sees the rows
  // that §4.9 (trading_order) owns or that are pure execution detail. Assert the WHERE clause.
  it('selects only Purchase/Sell rows with txId IS NOT NULL in booked contexts (no Reservation, no Trading swap)', async () => {
    const findSpy = mockBatch([]);
    await consumer.process();

    expect(findSpy).toHaveBeenCalledTimes(1);
    const where = findSpy.mock.calls[0][0].where as Record<string, unknown>;
    // txId IS NOT NULL (Not(IsNull())) — excludes Reservation rows without an on-chain settlement
    expect(where.txId).toEqual(Not(expect.anything()));
    // type IN (Purchase, Sell) — Reservation excluded (the Trading-context arb swap lives on trading_order.txId)
    expect(where.type).toEqual(In([LiquidityOrderType.PURCHASE, LiquidityOrderType.SELL]));
    // context IN (LiquidityManagement, BuyCrypto, Trading) — Return/Manual/RefPayout excluded (payout_order owns those)
    expect(where.context).toEqual(
      In([LiquidityOrderContext.LIQUIDITY_MANAGEMENT, LiquidityOrderContext.BUY_CRYPTO, LiquidityOrderContext.TRADING]),
    );
  });

  it('advances the watermark after a successful batch', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    mockBatch([liquidityOrder({ id: 18 })]);
    await consumer.process();
    const written = JSON.parse(setSpy.mock.calls[0][1]);
    expect(written.lastProcessedId).toBe(18);
  });

  it('no-ops on an empty batch', async () => {
    mockBatch([]);
    await consumer.process();
    expect(booked).toHaveLength(0);
  });
});
