import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { BuyCrypto } from 'src/subdomains/core/buy-crypto/process/entities/buy-crypto.entity';
import { RefReward } from 'src/subdomains/core/referral/reward/ref-reward.entity';
import { BuyFiat } from 'src/subdomains/core/sell-crypto/process/buy-fiat.entity';
import {
  PayoutOrder,
  PayoutOrderContext,
  PayoutOrderStatus,
} from 'src/subdomains/supporting/payout/entities/payout-order.entity';
import { MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'payout_order';
const CHF = 'CHF';
const AMOUNT_NULL_GUARD = 1e-12;

// LIABILITY bucket per context (§4.5 context-Branch); RefPayout uses an EXPENSE counter instead
const LIABILITY_BUCKET: Partial<Record<PayoutOrderContext, string>> = {
  [PayoutOrderContext.BUY_CRYPTO]: 'buyCrypto-owed',
  [PayoutOrderContext.BUY_CRYPTO_RETURN]: 'buyCrypto-owed',
  [PayoutOrderContext.BUY_FIAT_RETURN]: 'buyFiat-owed',
  [PayoutOrderContext.MANUAL]: 'manual-debt',
};

/**
 * The EINZIGE booker of all payout network fees (§4.5/§1.7, all contexts). Pure observer: reads payout_order
 * (+ ref_reward for the RefPayout correlationId join), writes only ledger_*.
 *
 * payout_order has no *Chf for the main amount → the wallet-ASSET Cr leg is stage-2 mark-valued and the
 * completion↔settlement mark drift is absorbed by an EXPENSE/INCOME fx-revaluation plug (Blocker R2-2). The
 * Dr counter branches on context: LIABILITY/{bucket} (BuyCrypto/Return/Manual) vs EXPENSE/refReward (RefPayout,
 * deterministic main leg priceChf = amountInChf/amount → no plug on the main leg, Minor R7-5). Native fee legs
 * go against the FEE asset (Major R7-1); a fee in the payout asset itself folds into the wallet leg.
 */
@Injectable()
export class PayoutOrderConsumer {
  private readonly logger = new DfxLogger(PayoutOrderConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(PayoutOrder) private readonly payoutOrderRepo: Repository<PayoutOrder>,
    @InjectRepository(RefReward) private readonly refRewardRepo: Repository<RefReward>,
    // read-only — the LIABILITY-Dr leg carries the owed completion CHF (amountInChf − totalFeeAmountChf, §4.5
    // "CHF aus Completion"); the WP1 repo summary lists only PayoutOrder/RefReward, but the §4.5 body requires
    // the completion CHF, derivable only from the linked product → these two read-repos are needed (deviation
    // documented). correlationId == product.id (buy-crypto-out.service.ts:142 / buy-fiat.service.ts:283).
    @InjectRepository(BuyCrypto) private readonly buyCryptoRepo: Repository<BuyCrypto>,
    @InjectRepository(BuyFiat) private readonly buyFiatRepo: Repository<BuyFiat>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    // settlement = status='Complete' (per-chain complete() transition, all chains, §4.5)
    const batch = await this.payoutOrderRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), status: PayoutOrderStatus.COMPLETE },
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
        this.logger.error(`Failed to book payout_order ${order.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  private async book(order: PayoutOrder, marks: LedgerMarkCache): Promise<void> {
    if (await this.alreadyBooked(order.id)) return; // idempotent re-run
    if (!order.asset) throw new Error(`payout_order ${order.id} has no asset`);
    if (Math.abs(order.amount) < AMOUNT_NULL_GUARD) {
      this.logger.error(`payout_order ${order.id} has amount≈0 — skip (avoids NaN priceChf, Minor R6-6)`);
      return;
    }

    const bookingDate = order.updated;
    const counter =
      order.context === PayoutOrderContext.REF_PAYOUT
        ? await this.refRewardCounter(order)
        : await this.liabilityCounter(order, bookingDate, marks);
    if (!counter) return;

    // the wallet-ASSET Cr leg + the payout-asset fee folded into it (Major R7-1 / Minor R13-3)
    const wallet = await this.assetAccount(order.asset);
    const walletLeg = this.walletCrLeg(order, counter, marks, bookingDate, wallet);

    const legs: LedgerLegInput[] = [counter.leg, walletLeg];
    await this.appendDistinctFeeLegs(order, bookingDate, marks, legs);

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      sourceId: `${order.id}`,
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs: await this.withFxPlug(legs),
    });
  }

  /**
   * The wallet-ASSET Cr leg. The main payout amount is mark-valued (liability contexts) or amountInChf-anchored
   * (RefPayout, deterministic). A fee hop in the payout asset itself folds in here (native + mark-based CHF),
   * making the combined leg's priceChf a mixed effective rate (NOT a market mark, Minor R7-5 / R13-3).
   */
  private walletCrLeg(
    order: PayoutOrder,
    counter: PayoutCounter,
    marks: LedgerMarkCache,
    bookingDate: Date,
    wallet: LedgerAccount,
  ): LedgerLegInput {
    const fee = this.payoutAssetFeeNative(order, marks, bookingDate);

    const native = Util.round(order.amount + fee.amount, 8);
    const mainChf = counter.mainChf; // mark × amount (liability) or amountInChf (RefPayout)
    const chf = mainChf != null ? Util.round(mainChf + fee.chf, 2) : undefined;
    const needsMark = counter.needsMark || (fee.amount !== 0 && fee.needsMark);

    return {
      account: wallet,
      amount: -native,
      priceChf: chf != null && Math.abs(native) >= AMOUNT_NULL_GUARD ? Util.round(chf / native, 8) : null,
      amountChf: chf != null ? -chf : undefined,
      needsMark,
    };
  }

  // §4.5 RefPayout Dr leg: EXPENSE/refReward = ref_reward.amountInChf (deterministic main-leg CHF, no plug)
  private async refRewardCounter(order: PayoutOrder): Promise<PayoutCounter | undefined> {
    // payout_order.correlationId = ref_reward.id (string) for RefPayout (ref-reward-out.service.ts:73)
    const reward = await this.refRewardRepo.findOneBy({ id: +order.correlationId });
    const amountInChf = reward?.amountInChf;
    if (amountInChf == null) {
      this.logger.error(`payout_order ${order.id} RefPayout has no ref_reward.amountInChf — skip`);
      return undefined;
    }

    return { leg: this.namedLeg(await this.expense('refReward'), amountInChf), mainChf: amountInChf, needsMark: false };
  }

  /**
   * §4.5 BuyCrypto/BuyCryptoReturn/BuyFiatReturn/Manual Dr leg: LIABILITY/{bucket}. The Dr CHF is the owed
   * COMPLETION value (amountInChf − totalFeeAmountChf of the linked product, the value §4.6/§4.7 seq1 credited to
   * owed) so `owed` closes cent-exact to 0; the wallet Cr leg is the settlement mark × amount, and the
   * completion↔settlement drift is taken by the fx-revaluation plug (Blocker R2-2). If the completion CHF cannot
   * be resolved (non-numeric correlationId / Manual / not found), fall back to the settlement mark (defensive).
   */
  private async liabilityCounter(
    order: PayoutOrder,
    bookingDate: Date,
    marks: LedgerMarkCache,
  ): Promise<PayoutCounter | undefined> {
    const bucket = LIABILITY_BUCKET[order.context];
    if (!bucket) {
      this.logger.error(`payout_order ${order.id} has unhandled context ${order.context} — skip`);
      return undefined;
    }

    const completionChf = await this.owedCompletionChf(order); // the persisted owed value (§4.5 "CHF aus Completion")
    const mark = marks.getMarkAt(order.asset.id, bookingDate);
    const settlementChf = mark != null ? Util.round(mark * order.amount, 2) : undefined;

    // Dr LIABILITY = completion CHF (closes owed to 0); mainChf = settlement mark × amount (values the wallet leg
    // → the drift completion↔settlement lands in the fx plug)
    const liabilityChf = completionChf ?? settlementChf;
    const needsMark = settlementChf == null;

    return {
      leg: {
        account: await this.liability(bucket),
        amount: liabilityChf ?? 0,
        priceChf: 1,
        amountChf: liabilityChf,
        needsMark: liabilityChf == null,
      },
      mainChf: settlementChf,
      needsMark,
    };
  }

  // the owed completion CHF (amountInChf − totalFeeAmountChf) of the linked product (§4.5). correlationId ==
  // product.id; BuyCrypto/BuyCryptoReturn → buy_crypto, BuyFiatReturn → buy_fiat. undefined → mark fallback.
  private async owedCompletionChf(order: PayoutOrder): Promise<number | undefined> {
    const id = +order.correlationId;
    if (!Number.isInteger(id)) return undefined; // e.g. network-start-fee correlationId → mark fallback

    if (order.context === PayoutOrderContext.BUY_FIAT_RETURN) {
      const bf = await this.buyFiatRepo.findOneBy({ id });
      return this.completionChf(bf?.amountInChf, bf?.totalFeeAmountChf);
    }

    const bc = await this.buyCryptoRepo.findOneBy({ id });
    return this.completionChf(bc?.amountInChf, bc?.totalFeeAmountChf);
  }

  private completionChf(amountInChf?: number, totalFeeAmountChf?: number): number | undefined {
    if (amountInChf == null) return undefined;
    return Util.round(amountInChf - (totalFeeAmountChf ?? 0), 2);
  }

  /**
   * §4.5 network fee (D14 A.2, Major R2-5 null-strategy + Major R7-1 fee-asset disambiguation). Adds the
   * EXPENSE/network-fee CHF leg = (preparationFeeAmountChf ?? 0) + (payoutFeeAmountChf ?? 0) (additive, NOT the
   * NaN-prone feeAmountChf getter) + one native Cr leg per DISTINCT fee asset (≠ payout asset; the payout-asset
   * fee was already folded into the wallet leg). networkFeeChf === 0 → no fee leg at all.
   */
  private async appendDistinctFeeLegs(
    order: PayoutOrder,
    bookingDate: Date,
    marks: LedgerMarkCache,
    legs: LedgerLegInput[],
  ): Promise<void> {
    const feeChf = this.networkFeeChf(order);
    if (feeChf === 0) return; // LN (Fee=0) or both null → no fee leg (Null-Strategie §5.1)

    legs.push(this.namedLeg(await this.expense('network-fee'), feeChf));

    const feeByAsset = new Map<number, { asset: Asset; amount: number }>();
    this.addFeeNative(feeByAsset, order.preparationFeeAsset, order.preparationFeeAmount);
    this.addFeeNative(feeByAsset, order.payoutFeeAsset, order.payoutFeeAmount);

    for (const { asset, amount } of feeByAsset.values()) {
      if (asset.id === order.asset.id) continue; // payout-asset fee already folded into the wallet leg
      const mark = marks.getMarkAt(asset.id, bookingDate);
      const chf = mark != null ? Util.round(mark * amount, 2) : undefined;
      legs.push({
        account: await this.assetAccount(asset),
        amount: -amount,
        priceChf: mark ?? null,
        amountChf: chf != null ? -chf : undefined,
        needsMark: chf == null,
      });
    }
  }

  // native fee amount whose asset == payout asset (folded into the wallet leg); CHF share is mark-based, the
  // persisted-vs-mark residual closes via the fx/ROUNDING plug
  private payoutAssetFeeNative(
    order: PayoutOrder,
    marks: LedgerMarkCache,
    bookingDate: Date,
  ): { amount: number; chf: number; needsMark: boolean } {
    let amount = 0;
    if (order.preparationFeeAsset?.id === order.asset.id) amount += order.preparationFeeAmount ?? 0;
    if (order.payoutFeeAsset?.id === order.asset.id) amount += order.payoutFeeAmount ?? 0;
    if (amount === 0) return { amount: 0, chf: 0, needsMark: false };

    const mark = marks.getMarkAt(order.asset.id, bookingDate);
    return {
      amount: Util.round(amount, 8),
      chf: mark != null ? Util.round(mark * amount, 2) : 0,
      needsMark: mark == null,
    };
  }

  private addFeeNative(map: Map<number, { asset: Asset; amount: number }>, asset?: Asset, amount?: number): void {
    if (!asset || amount == null || amount === 0) return;
    const existing = map.get(asset.id);
    if (existing) existing.amount = Util.round(existing.amount + amount, 8);
    else map.set(asset.id, { asset, amount });
  }

  // (preparationFeeAmountChf ?? 0) + (payoutFeeAmountChf ?? 0) — additive, direct (NOT the NaN-prone getter)
  private networkFeeChf(order: PayoutOrder): number {
    return Util.round((order.preparationFeeAmountChf ?? 0) + (order.payoutFeeAmountChf ?? 0), 2);
  }

  // --- HELPERS --- //

  // appends an EXPENSE/INCOME fx-revaluation plug for the CHF residual > tolerance (§4.5); sub-cent → ROUNDING
  private async withFxPlug(legs: LedgerLegInput[]): Promise<LedgerLegInput[]> {
    const sumCents = legs.reduce((s, l) => s + Math.round(Util.round(l.amountChf ?? 0, 2) * 100), 0);
    if (Math.abs(sumCents) <= Config.ledger.roundingToleranceCents) return legs;

    const residualChf = Util.round(-sumCents / 100, 2);
    const account = residualChf >= 0 ? await this.income('fx-revaluation') : await this.expense('fx-revaluation');
    legs.push(this.namedLeg(account, residualChf));

    return legs;
  }

  // CHF-denominated counter leg: native amount == CHF amount, priceChf = 1
  private namedLeg(account: LedgerAccount, amountChf: number): LedgerLegInput {
    return { account, amount: amountChf, priceChf: 1, amountChf };
  }

  private async alreadyBooked(id: number): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, `${id}`)) > 0;
  }

  private async assetAccount(asset: Asset): Promise<LedgerAccount> {
    const account = await this.accountService.findByAssetId(asset.id);
    if (!account) throw new Error(`ledger account for asset ${asset.id} not found (CoA bootstrap missing)`);
    return account;
  }

  private liability(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`LIABILITY/${qualifier}`, AccountType.LIABILITY, CHF);
  }

  private expense(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`EXPENSE/${qualifier}`, AccountType.EXPENSE, CHF);
  }

  private income(qualifier: string): Promise<LedgerAccount> {
    return this.accountService.findOrCreate(`INCOME/${qualifier}`, AccountType.INCOME, CHF);
  }
}

// the Dr counter leg (LIABILITY/{bucket} or EXPENSE/refReward) + the main-leg CHF used to value the wallet Cr leg
interface PayoutCounter {
  leg: LedgerLegInput;
  mainChf?: number; // mark × amount (liability) or amountInChf (RefPayout); undefined → wallet leg needsMark
  needsMark: boolean;
}
