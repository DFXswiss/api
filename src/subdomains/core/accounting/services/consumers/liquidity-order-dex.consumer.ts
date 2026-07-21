import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import {
  LiquidityOrder,
  LiquidityOrderContext,
  LiquidityOrderType,
} from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { resolveLegsOrDefer } from './ledger-mark-bridge.helper';
import {
  getLedgerWatermark,
  isCoveredByCutoverOpening,
  runContentChangeScan,
  setLedgerWatermark,
} from './ledger-watermark.helper';

const SOURCE_TYPE = 'liquidity_order';
const BOOKED_TYPES = [LiquidityOrderType.PURCHASE, LiquidityOrderType.SELL];
const CHF = 'CHF';
const DEX = 'DfxDex';

// the LM consumer (§4.8 branch 2) skips DfxDex purchase/sell on these contexts because THIS consumer books them.
// BuyFiatReturn/BuyCryptoReturn/Manual/RefPayout are excluded — their value-moving payout runs via the
// payout_order consumer (§4.5); their liquidity_order is purchase detail of the parent only (D10 §D.1).
const BOOKED_CONTEXTS = [
  LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
  LiquidityOrderContext.BUY_CRYPTO,
  LiquidityOrderContext.TRADING,
];

/**
 * §4.8a LiquidityOrderDex consumer (new, D14 §B.3/§B.6, D04 §7.2/§7.3; Blocker R5-1). Authoritative for DfxDex
 * purchase/sell ON-CHAIN swaps (txId IS NOT NULL). Pure observer: reads liquidity_order (dex subdomain), writes
 * only ledger_*.
 *
 * liquidity_order has NO *Chf field (targetAmount/swapAmount/feeAmount all native, D04 §0.2) → both ASSET legs +
 * the feeAmount leg are stage-2 mark-valued; the CHF residual of two independently mark-valued legs is a real
 * venue/valuation spread (NOT rounding) → a dedicated EXPENSE/INCOME spread-DfxDex plug leg, never ROUNDING
 * (§1.15/§1.11). The source @Index([context, correlationId]) is NOT unique (dex.service finds plural rows per
 * tuple), so the ledger sourceId carries the row id (`<context>:<correlationId>:<id>`) to stay row-unique; the
 * ledger UNIQUE(sourceType,sourceId,seq) then backstops idempotency (Minor R6-8).
 */
@Injectable()
export class LiquidityOrderDexConsumer {
  private readonly logger = new DfxLogger(LiquidityOrderDexConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(LiquidityOrder) private readonly liquidityOrderRepo: Repository<LiquidityOrder>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    await this.processForward(watermark);

    // content-change scan (§4.12 / C1): the forward id-scan filters txId IS NOT NULL + context + Purchase/Sell and
    // advances lastProcessedId OVER not-yet-settled ids (a Reservation row that later gets a txId, a context/type not
    // yet matching); such a row settling AFTER the watermark passed it is forward-unreachable. The status-agnostic
    // (updated, id)-cursor scan re-selects it and forward-books it idempotently (book() gates on alreadyBooked) once
    // it satisfies the settled filter. Re-read the watermark in case the forward batch advanced lastProcessedId above.
    const afterForward = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? watermark;
    await runContentChangeScan(
      this.settingService,
      SOURCE_TYPE,
      afterForward,
      this.liquidityOrderRepo,
      {},
      async (order: LiquidityOrder) => {
        // honour the forward settled-filter (txId set + booked context + Purchase/Sell); a row not yet matching it is
        // left (cursor advances; a later settle bumps `updated` → re-selected). book() is idempotent (per-sourceId
        // nextSeq gate).
        if (order.txId == null || !BOOKED_CONTEXTS.includes(order.context) || !BOOKED_TYPES.includes(order.type))
          return;
        // §6.3 covered-by-cutover-opening guard (boundary keyed by liquidity_order.id): a swap already settled at the
        // cutover snapshot is in the aggregate ASSET opening — its `updated` bump post-cutover re-selects it here, but
        // re-booking its seq0 would double-count. A hole / post-boundary row is NOT covered → it still books fresh.
        if (await isCoveredByCutoverOpening(this.settingService, SOURCE_TYPE, order.id)) return;
        await this.book(order, await this.preloadMarks([order]));
      },
    );
  }

  private async processForward(watermark: { lastProcessedId: number; lastReversalScan: Date }): Promise<void> {
    // type IN ('Purchase','Sell') AND txId IS NOT NULL excludes Reservation rows (no on-chain settlement, D10 §D.1).
    // context='Trading' liquidity_orders are exclusively type=Reservation (no own swap txId); the arb swap is booked
    // solely via trading_order.txId (§4.9). The type IN ('Purchase','Sell') AND txId IS NOT NULL filter excludes
    // them — no double booking with the trading_order consumer.
    const batch = await this.liquidityOrderRepo.find({
      where: {
        id: MoreThan(watermark.lastProcessedId),
        txId: Not(IsNull()),
        context: In(BOOKED_CONTEXTS),
        type: In(BOOKED_TYPES),
      },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const marks = await this.preloadMarks(batch);

    let lastProcessedId = watermark.lastProcessedId;
    for (const order of batch) {
      try {
        await this.book(order, marks);
        lastProcessedId = order.id;
      } catch (e) {
        this.logger.error(`Failed to book liquidity_order ${order.id}:`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  // mark cache with a 2-day lookback so getMarkAt finds the latest mark at-or-before the earliest row's `updated`
  private async preloadMarks(orders: LiquidityOrder[]): Promise<LedgerMarkCache> {
    const times = orders.map((o) => o.updated.getTime());
    return this.markService.preload(Util.daysBefore(2, new Date(Math.min(...times))), new Date(Math.max(...times)));
  }

  /**
   * §4.8a booking: Dr ASSET/{targetAsset} (mark) / Cr ASSET/{swapAsset} (mark) + EXPENSE/network-fee (feeAmount,
   * mark, against ASSET/{feeAsset}) + EXPENSE/INCOME spread-DfxDex = PLUG (the mark residual / venue spread).
   */
  private async book(order: LiquidityOrder, marks: LedgerMarkCache): Promise<void> {
    if (await this.alreadyBooked(order)) return; // idempotent re-run (§4.8a)

    const { targetAsset, swapAsset, targetAmount, swapAmount } = order;
    if (!targetAsset || !swapAsset || targetAmount == null || swapAmount == null) {
      this.logger.error(`liquidity_order ${order.id} has no valid swap (target/swap asset/amount missing) — skip`);
      return;
    }

    const bookingDate = order.updated;

    // both ASSET legs always via stage-2 mark (no *Chf field, §5.1); missing mark → needsMark, plug stays open
    // §2.3 exactness (#4287 stage 2): pass the captured DfxDex swap wei so each cross-asset leg books wei-exact.
    // A same-asset fee folded into a leg (appendFeeLegs → addToLeg) drops that leg's override (native then
    // diverges from the captured swap amount). The tx is cross-asset and carries CHF fee/spread legs, so it is
    // out of assertNativeBalance's same-currency ASSET/TRANSIT throw scope.
    const targetLeg = this.assetLeg(
      await this.assetAccount(targetAsset),
      targetAsset,
      +targetAmount,
      bookingDate,
      marks,
      order.targetAmountBaseUnits,
    );
    const swapLeg = this.assetLeg(
      await this.assetAccount(swapAsset),
      swapAsset,
      -swapAmount,
      bookingDate,
      marks,
      order.swapAmountBaseUnits,
    );

    const legs: LedgerLegInput[] = [targetLeg, swapLeg];
    await this.appendFeeLegs(order, bookingDate, marks, targetLeg, swapLeg, legs);
    await this.appendSpreadPlug(legs, `liquidity_order ${order.id}`);

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      // sourceId = '<context>:<correlationId>:<id>' — the row id makes it unique because the source
      // @Index([context, correlationId]) is NOT unique (plural rows per tuple); the ledger UNIQUE backstops it (R6-8)
      sourceId: this.sourceId(order),
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    });
  }

  /**
   * §4.8a fee leg (Major R7-1 fee-asset disambiguation + Major R2-5 null-strategy). feeAmount is native in
   * feeAsset → the network-fee EXPENSE CHF runs over getMarkAt(feeAsset); the native counter reduces
   * ASSET/{feeAsset}, NEVER blindly the swap/target asset. Three explicit cases.
   */
  private async appendFeeLegs(
    order: LiquidityOrder,
    bookingDate: Date,
    marks: LedgerMarkCache,
    targetLeg: LedgerLegInput,
    swapLeg: LedgerLegInput,
    legs: LedgerLegInput[],
  ): Promise<void> {
    const { feeAsset, feeAmount, targetAsset, swapAsset } = order;
    if (!feeAsset || feeAmount == null || feeAmount === 0) return; // null strategy §5.1: no fee → no fee leg

    // Major B5 (F2): the CHF EXPENSE/network-fee leg has no assetId, so resolveLegsOrDefer cannot bridge it — but it
    // WOULD bridge the fee's ASSET counter-leg (own leg or the folded swap/target leg) with getLatestMark. Bridging one
    // side while the other stays unvalued nets to the fee value → the swap wedges head-of-line (fee mark first fed AFTER
    // the swap date). Derive feeChf here from the SAME bridged mark the asset counter-leg uses (getLatestMark, same
    // asset) so both sides move in lockstep and Σ balances. needsMark stays true whenever the HISTORICAL mark was
    // absent → the leg is provisional and the mark-to-market job re-marks it later. A truly feedless fee asset (no
    // bridge either) leaves feeChf undefined → both fee legs stay unvalued → resolveLegsOrDefer defers the row.
    const historicalMark = marks.getMarkAt(feeAsset.id, bookingDate);
    const mark = historicalMark ?? (await this.markService.getLatestMark(feeAsset.id));
    const feeChf = mark != null ? Util.round(mark * feeAmount, 2) : undefined;
    const feeNeedsMark = historicalMark == null;

    // EXPENSE/network-fee (CHF-only) closes the CHF cross-asset side; the native fee leaves ASSET/{feeAsset}
    legs.push(this.networkFeeLeg(await this.expense('network-fee'), feeChf, feeNeedsMark));

    if (feeAsset.id === swapAsset.id) {
      // feeAsset == swapAsset: no own Cr leg — increase the existing Cr ASSET/swap leg by feeAmount (native + CHF)
      this.addToLeg(swapLeg, -feeAmount, feeChf != null ? -feeChf : undefined, feeNeedsMark);
      return;
    }
    if (feeAsset.id === targetAsset.id) {
      // feeAsset == targetAsset: reduce the existing Dr ASSET/target leg by feeAmount (the fee leaves the target)
      this.addToLeg(targetLeg, -feeAmount, feeChf != null ? -feeChf : undefined, feeNeedsMark);
      return;
    }

    // a THIRD asset (the typical case: native EVM gas ≠ swap/target): its own Cr ASSET/{feeAsset} native leg
    legs.push({
      account: await this.assetAccount(feeAsset),
      amount: -feeAmount,
      priceChf: mark ?? null,
      amountChf: feeChf != null ? -feeChf : undefined,
      needsMark: feeNeedsMark,
      // §2.3 exactness (#4287 stage 3): book the EXACT gas-fee wei verbatim on this un-folded third-asset fee leg
      // (negated for the credit) — the leg's native quantity IS feeAmount, so the captured wei matches exactly. The
      // folded swap/target branches (addToLeg) drop the override and derive. Cross-asset tx with CHF fee legs -> out
      // of assertNativeBalance same-currency throw scope. null -> derive from the float (fail-open).
      amountBaseUnits: order.feeAmountBaseUnits != null ? -order.feeAmountBaseUnits : undefined,
    });
  }

  // appends an EXPENSE/INCOME spread-DfxDex plug for the CHF residual; sub-cent → ROUNDING (booking service).
  // Major B5: an ASSET/fee leg without a historical mark is first bridged with the youngest available mark
  // (resolveLegsOrDefer) so the swap balances — needsMark stays true, the mark-to-market job corrects the basis later.
  // A truly feedless swap/fee asset (no bridge) defers the row instead of handing an unbalanceable set to bookTx.
  private async appendSpreadPlug(legs: LedgerLegInput[], ref: string): Promise<void> {
    if (!(await resolveLegsOrDefer(legs, this.markService, this.logger, ref))) return;

    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return;

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? await this.income(`spread-${DEX}`) : await this.expense(`spread-${DEX}`);
    legs.push({ account, amount: residualChf, priceChf: 1, amountChf: residualChf });
  }

  // --- LEG BUILDERS --- //

  private assetLeg(
    account: LedgerAccount,
    asset: Asset,
    amount: number,
    bookingDate: Date,
    marks: LedgerMarkCache,
    exactBaseUnits?: bigint | null,
  ): LedgerLegInput {
    const mark = marks.getMarkAt(asset.id, bookingDate);
    const chf = mark != null ? Util.round(mark * Math.abs(amount), 2) : undefined;
    return {
      account,
      amount,
      priceChf: mark ?? null,
      amountChf: chf != null ? (amount >= 0 ? chf : -chf) : undefined,
      needsMark: chf == null,
      // §2.3 exactness (#4287 stage 2): book the EXACT captured swap wei verbatim, signed to match the leg amount
      // (the entity stores a positive magnitude); null → derive from the ≤8-dp float (fail-open).
      amountBaseUnits: exactBaseUnits != null ? (amount >= 0 ? exactBaseUnits : -exactBaseUnits) : undefined,
    };
  }

  // CHF-only EXPENSE/network-fee leg (native side is the ASSET/{feeAsset} leg)
  private networkFeeLeg(account: LedgerAccount, feeChf: number | undefined, needsMark: boolean): LedgerLegInput {
    return { account, amount: feeChf ?? 0, priceChf: 1, amountChf: feeChf, needsMark };
  }

  private addToLeg(leg: LedgerLegInput, nativeDelta: number, chfDelta: number | undefined, needsMark: boolean): void {
    leg.amount = Util.round(leg.amount + nativeDelta, 8);
    if (chfDelta != null && leg.amountChf != null) leg.amountChf = Util.round(leg.amountChf + chfDelta, 2);
    if (needsMark || chfDelta == null) leg.needsMark = true;
    // §2.3 exactness (#4287 stage 2): a folded same-asset fee makes this leg's native quantity (amount + fee)
    // diverge from the captured swap wei (which represents the un-folded swap amount) → drop the exact override
    // and derive from the float (mirrors stage-1 payout's fee-fold rule).
    leg.amountBaseUnits = undefined;
  }

  // --- HELPERS --- //

  private sourceId(order: LiquidityOrder): string {
    return `${order.context}:${order.correlationId}:${order.id}`;
  }

  private async assetAccount(asset: Asset): Promise<LedgerAccount> {
    const account = await this.accountService.findByAssetId(asset.id);
    if (!account) throw new Error(`Ledger account for asset ${asset.id} not found (CoA bootstrap missing)`);
    return account;
  }

  private expense(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`EXPENSE/${qualifier}`, AccountType.EXPENSE, CHF);
  }

  private income(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`INCOME/${qualifier}`, AccountType.INCOME, CHF);
  }

  private async alreadyBooked(order: LiquidityOrder): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, this.sourceId(order))) > 0;
  }
}
