import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { TradingOrder } from 'src/subdomains/core/trading/entities/trading-order.entity';
import { TradingOrderStatus } from 'src/subdomains/core/trading/enums';
import { IsNull, MoreThan, Not, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'trading_order';
const CHF = 'CHF';
// trading orders are DfxDex on-chain pool swaps (trading-order.service swapPool) → the swap-venue spread is DfxDex
const SWAP_VENUE = 'DfxDex';

/**
 * §4.9 TradingOrder consumer (NEU, D10 D, D14 B.4; Blocker R1-3). Books DFX arbitrage swaps. Pure observer: reads
 * trading_order (assetIn/assetOut eager-loaded), writes only ledger_*. No cross-check (D14 B.4: trading_order.txId
 * ∉ liquidity_order, no overlap with §4.8a).
 *
 * trading_order.amountIn/amountOut are native only (no *Chf) → both ASSET legs are stage-2 mark-valued; the CHF
 * residual against the persisted fee/profit legs is a real valuation spread (NOT rounding) → a dedicated
 * EXPENSE/INCOME spread-arbitrage plug leg, never ROUNDING (§1.15/§1.11/Blocker R1-3).
 */
@Injectable()
export class TradingOrderConsumer {
  private readonly logger = new DfxLogger(TradingOrderConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(TradingOrder) private readonly tradingOrderRepo: Repository<TradingOrder>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    // only settled swaps: status='Complete' AND txId IS NOT NULL (§4.9)
    const batch = await this.tradingOrderRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), status: TradingOrderStatus.COMPLETE, txId: Not(IsNull()) },
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
        this.logger.error(`Failed to book trading_order ${order.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  /**
   * §4.9 booking: Dr ASSET/{assetOut} (markOut) / Cr ASSET/{assetIn} (markIn) + EXPENSE/network-fee (txFeeAmountChf)
   * + EXPENSE/spread-{venue} (swapFeeAmountChf) + INCOME/trading (profitChf) + EXPENSE/INCOME spread-arbitrage =
   * PLUG (the mark residual). The persisted fee/profit legs are booked only when their field != null (Major R2-5
   * null-strategy, no ?? 0 default for a real number).
   */
  private async book(order: TradingOrder, marks: LedgerMarkCache): Promise<void> {
    if (await this.alreadyBooked(order.id)) return; // idempotent re-run (§4.9)

    const { assetIn, assetOut, amountIn, amountOut } = order;
    if (!assetIn || !assetOut || amountIn == null || amountOut == null) {
      this.logger.error(`trading_order ${order.id} has no valid swap (amountIn/amountOut missing) — skip`);
      return;
    }

    const bookingDate = order.updated;

    // both ASSET legs always via stage-2 mark (no *Chf field, §5.1); missing mark → needsMark, plug stays open
    const outLeg = this.assetLeg(await this.assetAccount(assetOut), assetOut, +amountOut, bookingDate, marks);
    const inLeg = this.assetLeg(await this.assetAccount(assetIn), assetIn, -amountIn, bookingDate, marks);

    const legs: LedgerLegInput[] = [outLeg, inLeg];

    // persisted CHF-only fee/profit legs (Major R2-5: book only when field != null, never ?? 0)
    if (order.txFeeAmountChf != null) legs.push(this.chfLeg(await this.expense('network-fee'), order.txFeeAmountChf));
    if (order.swapFeeAmountChf != null)
      legs.push(this.chfLeg(await this.expense(`spread-${SWAP_VENUE}`), order.swapFeeAmountChf));
    if (order.profitChf != null) legs.push(this.chfLeg(await this.income('trading'), -order.profitChf));

    await this.appendArbitragePlug(legs);

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${order.id}`,
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    });
  }

  /**
   * The spread-arbitrage plug absorbs the residual between the mark-valued ASSET legs and the persisted fee/profit
   * legs so Σ CHF closes to 0 (Blocker R1-3, NOT ROUNDING). Residual > 0 → INCOME/spread-arbitrage; < 0 →
   * EXPENSE/spread-arbitrage. Skips the plug when any ASSET leg still needsMark (no silent plug without a mark,
   * §5.1 Stufe 3 / §4.9) — mark-to-market revalues then. Sub-cent rest → ROUNDING (booking service).
   */
  private async appendArbitragePlug(legs: LedgerLegInput[]): Promise<void> {
    if (legs.some((l) => l.needsMark)) return;

    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return;

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? await this.income('spread-arbitrage') : await this.expense('spread-arbitrage');
    legs.push(this.chfLeg(account, residualChf));
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

  // CHF-denominated leg: native amount == CHF amount, priceChf = 1
  private chfLeg(account: LedgerAccount, amountChf: number): LedgerLegInput {
    return { account, amount: amountChf, priceChf: 1, amountChf };
  }

  // --- HELPERS --- //

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

  private async alreadyBooked(id: number): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, `${id}`)) > 0;
  }
}
