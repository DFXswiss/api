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
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'liquidity_order';
const CHF = 'CHF';
const DEX = 'DfxDex';

// the LM consumer (§4.8 Zweig 2) skips DfxDex purchase/sell on these contexts because THIS consumer books them.
// BuyFiatReturn/BuyCryptoReturn/Manual/RefPayout are excluded — their value-moving payout runs via the
// payout_order consumer (§4.5); their liquidity_order is purchase detail of the parent only (D10 §D.1).
const BOOKED_CONTEXTS = [
  LiquidityOrderContext.LIQUIDITY_MANAGEMENT,
  LiquidityOrderContext.BUY_CRYPTO,
  LiquidityOrderContext.TRADING,
];

/**
 * §4.8a LiquidityOrderDex consumer (NEU, D14 §B.3/§B.6, D04 §7.2/§7.3; Blocker R5-1). Authoritative for DfxDex
 * purchase/sell ON-CHAIN swaps (txId IS NOT NULL). Pure observer: reads liquidity_order (dex subdomain), writes
 * only ledger_*.
 *
 * liquidity_order has NO *Chf field (targetAmount/swapAmount/feeAmount all native, D04 §0.2) → both ASSET legs +
 * the feeAmount leg are stage-2 mark-valued; the CHF residual of two independently mark-valued legs is a real
 * venue/valuation spread (NOT rounding) → a dedicated EXPENSE/INCOME spread-DfxDex plug leg, never ROUNDING
 * (§1.15/§1.11). Idempotency/uniqueness rest SOLELY on the ledger UNIQUE(sourceType,sourceId,seq) — the source
 * @Index([context, correlationId]) is NOT unique (Minor R6-8).
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

    // type IN ('Purchase','Sell') AND txId IS NOT NULL excludes Reservation rows (no on-chain settlement, D10 §D.1).
    // context='Trading' liquidity_orders are exclusively type=Reservation (no own swap txId); the arb swap is booked
    // solely via trading_order.txId (§4.9). The type IN ('Purchase','Sell') AND txId IS NOT NULL filter excludes
    // them — no double booking with the trading_order consumer.
    const batch = await this.liquidityOrderRepo.find({
      where: {
        id: MoreThan(watermark.lastProcessedId),
        txId: Not(IsNull()),
        context: In(BOOKED_CONTEXTS),
        type: In([LiquidityOrderType.PURCHASE, LiquidityOrderType.SELL]),
      },
      order: { id: 'ASC' },
      take: Config.ledger.backfillBatchSize,
    });
    if (!batch.length) return;

    const times = batch.map((o) => o.updated.getTime());
    const marks = await this.markService.preload(new Date(Math.min(...times)), new Date(Math.max(...times)));

    let lastProcessedId = watermark.lastProcessedId;
    for (const order of batch) {
      try {
        await this.book(order, marks);
        lastProcessedId = order.id;
      } catch (e) {
        this.logger.error(`Failed to book liquidity_order ${order.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
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
    const targetLeg = this.assetLeg(
      await this.assetAccount(targetAsset),
      targetAsset,
      +targetAmount,
      bookingDate,
      marks,
    );
    const swapLeg = this.assetLeg(await this.assetAccount(swapAsset), swapAsset, -swapAmount, bookingDate, marks);

    const legs: LedgerLegInput[] = [targetLeg, swapLeg];
    await this.appendFeeLegs(order, bookingDate, marks, targetLeg, swapLeg, legs);
    await this.appendSpreadPlug(legs);

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      // sourceId = '<context>:<correlationId>' (Minor R6-8: uniqueness rests on the ledger UNIQUE, not the
      // non-unique source @Index([context, correlationId]))
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
    if (!feeAsset || feeAmount == null || feeAmount === 0) return; // Null-Strategie §5.1: no fee → no fee leg

    const mark = marks.getMarkAt(feeAsset.id, bookingDate);
    const feeChf = mark != null ? Util.round(mark * feeAmount, 2) : undefined;
    const feeNeedsMark = feeChf == null;

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
    });
  }

  // appends an EXPENSE/INCOME spread-DfxDex plug for the CHF residual; sub-cent → ROUNDING (booking service).
  // Skips the plug when any leg still needsMark (no silent plug without a mark, §5.1 Stufe 3 / §4.8a).
  private async appendSpreadPlug(legs: LedgerLegInput[]): Promise<void> {
    if (legs.some((l) => l.needsMark)) return;

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
  ): LedgerLegInput {
    const mark = marks.getMarkAt(asset.id, bookingDate);
    const chf = mark != null ? Util.round(mark * Math.abs(amount), 2) : undefined;
    return {
      account,
      amount,
      priceChf: mark ?? null,
      amountChf: chf != null ? (amount >= 0 ? chf : -chf) : undefined,
      needsMark: chf == null,
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
  }

  // --- HELPERS --- //

  private sourceId(order: LiquidityOrder): string {
    return `${order.context}:${order.correlationId}`;
  }

  private async assetAccount(asset: Asset): Promise<LedgerAccount> {
    const account = await this.accountService.findByAssetId(asset.id);
    if (!account) throw new Error(`ledger account for asset ${asset.id} not found (CoA bootstrap missing)`);
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
