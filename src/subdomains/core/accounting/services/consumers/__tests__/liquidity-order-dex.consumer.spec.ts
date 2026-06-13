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
import { In, IsNull, Not, Repository } from 'typeorm';
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
    // txId IS NOT NULL — must match the source filter EXACTLY: Not(IsNull()), a FindOperator wrapping an IsNull
    // operator. The old `Not(expect.anything())` was a tautology that would also pass for Not(MoreThan(0)) etc. — it
    // never actually pinned the IS-NOT-NULL semantics. Not(IsNull()) deep-equals the source-built operator.
    expect(where.txId).toEqual(Not(IsNull()));
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

  // §4.8a spread plug sign: a residual ≥ 0 books INCOME/spread-DfxDex (the opposite branch of the EXPENSE case above).
  // target mark 1.05 < swap mark such that Σ(legs) < 0 → residual = −Σ > 0 → INCOME. Use swap mark < target so the
  // swap Cr (negative) is smaller in magnitude than the target Dr → sum positive → residual negative... so to force a
  // POSITIVE residual we need Σ legs < 0: target Dr (+) smaller than swap Cr magnitude. swapAmount 1050 × 0.95 = 997.5;
  // target 900 × 1.05 = 945 → Σ = 945 − 997.5 = −52.5 → residual +52.5 → INCOME/spread-DfxDex.
  it('books a positive spread residual to INCOME/spread-DfxDex (opposite sign branch)', async () => {
    mockBatch([liquidityOrder({ id: 19, targetAmount: 900 })]);
    await consumer.process();

    const tx = booked[0];
    expect(leg(tx, 'Ethereum/EURC').amountChf).toBe(945); // 900 × 1.05
    expect(leg(tx, 'Ethereum/USDC').amountChf).toBe(-997.5); // 1050 × 0.95
    expect(leg(tx, 'INCOME/spread-DfxDex').amountChf).toBe(52.5); // residual = −(945 − 997.5) = +52.5 ≥ 0 → INCOME
    expect(leg(tx, 'EXPENSE/spread-DfxDex')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });

  // §4-header failure-isolation: a booking error stops the batch and leaves the watermark unchanged (retry next run)
  it('stops the batch and leaves the watermark on a booking error (failure-isolation)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(bookingService, 'bookTx').mockRejectedValue(new Error('db down'));
    mockBatch([liquidityOrder({ id: 20 })]);

    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled(); // throw → break before advancing → watermark stays
  });

  // §4.8a Major R7-1 case 3 with NO mark for the third (gas) fee asset → the network-fee CHF leg is needsMark and the
  // fee Cr ASSET leg carries amountChf undefined (lines 155/176-177 undefined sides + 217 feeChf ?? 0). Because a leg
  // needsMark, appendSpreadPlug books no plug.
  it('flags the gas-fee legs needsMark when the fee asset has no mark (lines 155/176-177/217)', async () => {
    jest.spyOn(markService, 'preload').mockResolvedValue(
      new LedgerMarkCache(
        new Map([
          [EURC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 1.05 }]],
          [USDC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 0.95 }]],
          // ETH (fee asset) deliberately absent → no fee mark
        ]),
      ),
    );
    mockBatch([
      liquidityOrder({ id: 21, feeAsset: { id: ETH_ASSET_ID, uniqueName: 'Ethereum/ETH' }, feeAmount: 0.01 }),
    ]);
    await consumer.process();

    const tx = booked[0];
    const networkFee = leg(tx, 'EXPENSE/network-fee');
    const ethLeg = leg(tx, 'Ethereum/ETH');
    expect(networkFee.needsMark).toBe(true); // feeChf undefined → needsMark
    expect(networkFee.amountChf).toBeUndefined();
    expect(networkFee.amount).toBe(0); // networkFeeLeg `feeChf ?? 0` → 0
    expect(ethLeg.needsMark).toBe(true);
    expect(ethLeg.amountChf).toBeUndefined();
    expect(leg(tx, 'EXPENSE/spread-DfxDex')).toBeUndefined(); // a needsMark leg → no spread plug
    expect(leg(tx, 'INCOME/spread-DfxDex')).toBeUndefined();
  });

  // §4.8a Major R7-1 case 1 (feeAsset == swapAsset) with NO fee mark → addToLeg `needsMark` true side (lines 163/223):
  // the swap leg's native grows by the fee but its CHF stays unmovable and the leg becomes needsMark.
  it('folds a no-mark swap-asset fee and marks the combined leg needsMark (lines 163/223)', async () => {
    jest.spyOn(markService, 'preload').mockResolvedValue(
      new LedgerMarkCache(new Map([[EURC_ASSET_ID, [{ created: new Date('2026-01-01'), priceChf: 1.05 }]]])), // USDC absent
    );
    mockBatch([liquidityOrder({ id: 22, feeAsset: { id: USDC_ASSET_ID, uniqueName: 'Ethereum/USDC' }, feeAmount: 5 })]);
    await consumer.process();

    const tx = booked[0];
    const swapLegs = tx.legs.filter((l) => l.account.name === 'Ethereum/USDC');
    expect(swapLegs).toHaveLength(1);
    expect(swapLegs[0].amount).toBe(-1055); // −1050 − 5 folded native
    expect(swapLegs[0].needsMark).toBe(true); // no swap mark → combined leg needsMark
    expect(leg(tx, 'EXPENSE/network-fee').needsMark).toBe(true);
  });

  // §4.8a appendSpreadPlug sub-cent branch (lines 187-188): a swap whose two mark legs net to 0 (within tolerance) →
  // NO spread plug appended. EURC 1000 × 1.05 = 1050; USDC swapAmount chosen so 0.95 × amount = 1050 → amount ≈ 1105.26
  // is not clean; instead use equal marks via a swap where target CHF == swap CHF exactly.
  it('appends no spread plug when the two mark legs net to zero (sub-cent, lines 187-188)', async () => {
    // target 1000 × 1.05 = 1050; swap 1105.263158 × 0.95 = 1050.00 → Σ ≈ 0 (within the 2-cent tolerance)
    mockBatch([liquidityOrder({ id: 23, swapAmount: 1105.263158 })]);
    await consumer.process();

    const tx = booked[0];
    expect(leg(tx, 'Ethereum/EURC').amountChf).toBe(1050);
    expect(leg(tx, 'Ethereum/USDC').amountChf).toBe(-1050); // round(1105.263158 × 0.95, 2) = 1050.00
    expect(leg(tx, 'EXPENSE/spread-DfxDex')).toBeUndefined(); // residual 0 → sub-cent → no plug
    expect(leg(tx, 'INCOME/spread-DfxDex')).toBeUndefined();
    expect(cents(tx.legs)).toBe(0);
  });

  // §4.8a assetAccount throw (line 234): an asset with no CoA ledger account → throws → failure-isolation.
  it('stops the batch and leaves the watermark when an asset has no ledger account (line 234)', async () => {
    const setSpy = jest.spyOn(settingService, 'set').mockResolvedValue();
    jest.spyOn(accountService, 'findByAssetId').mockResolvedValue(undefined);
    mockBatch([liquidityOrder({ id: 24 })]);

    await consumer.process();

    expect(booked).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled();
  });
});
