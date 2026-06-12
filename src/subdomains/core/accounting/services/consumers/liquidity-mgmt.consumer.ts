import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Config } from 'src/config/config';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SettingService } from 'src/shared/models/setting/setting.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { LiquidityManagementOrder } from 'src/subdomains/core/liquidity-management/entities/liquidity-management-order.entity';
import {
  LiquidityManagementBridges,
  LiquidityManagementExchanges,
  LiquidityManagementOrderStatus,
  LiquidityManagementSystem,
} from 'src/subdomains/core/liquidity-management/enums';
import { MoreThan, Repository } from 'typeorm';
import { AccountType, LedgerAccount } from '../../entities/ledger-account.entity';
import { LedgerAccountService } from '../ledger-account.service';
import { LedgerBookingService, LedgerLegInput } from '../ledger-booking.service';
import { LedgerMarkCache, LedgerMarkService } from '../ledger-mark.service';
import { getLedgerWatermark, setLedgerWatermark } from './ledger-watermark.helper';

const SOURCE_TYPE = 'liquidity_management_order';
const BRIDGE_IN_COMMAND = 'bridge-in'; // dEURO bridge-in (§4.8 Zweig 4, system=dEURO)

/**
 * §4.8 LiquidityMgmt consumer (D14 B.5/B.6). Pure observer: reads liquidity_management_order (+ its eager action),
 * writes only ledger_*. It books ONLY bridge / external-record-less transfers — every other movement is booked by
 * a more specific authoritative consumer, so this consumer skips it after a read-only cross-check (no external
 * call). Each skip branch carries a mandatory comment naming the authoritative source + the correlationId join.
 *
 * The four cross-check branches (§4.1 matrix):
 *  (1) action.system ∈ exchange systems          → SKIP (exchange_tx authoritative)
 *  (2) action.system='DfxDex' && command∈{purchase,sell} → SKIP (liquidity_order (dex) authoritative, §4.8a)
 *  (3) action.system='DfxDex' && command='withdraw'      → SKIP (target deposit exchange_tx authoritative)
 *  (4) action.system ∈ bridge systems (*Bridge / dEURO bridge-in) → BOOK as a TRANSIT/bridge movement
 */
@Injectable()
export class LiquidityMgmtConsumer {
  private readonly logger = new DfxLogger(LiquidityMgmtConsumer);

  constructor(
    private readonly settingService: SettingService,
    private readonly bookingService: LedgerBookingService,
    private readonly accountService: LedgerAccountService,
    private readonly markService: LedgerMarkService,
    @InjectRepository(LiquidityManagementOrder)
    private readonly liquidityManagementOrderRepo: Repository<LiquidityManagementOrder>,
  ) {}

  async process(): Promise<void> {
    const watermark = (await getLedgerWatermark(this.settingService, SOURCE_TYPE)) ?? {
      lastProcessedId: 0,
      lastReversalScan: new Date(0),
    };

    const batch = await this.liquidityManagementOrderRepo.find({
      where: { id: MoreThan(watermark.lastProcessedId), status: LiquidityManagementOrderStatus.COMPLETE },
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
        this.logger.error(`Failed to book liquidity_management_order ${order.id}`, e);
        break; // failure-isolation: leave watermark unchanged, retry next run (§4-header)
      }
    }

    if (lastProcessedId > watermark.lastProcessedId) {
      await setLedgerWatermark(this.settingService, SOURCE_TYPE, { ...watermark, lastProcessedId });
    }
  }

  /**
   * Cross-check (read-only, no external call) THEN book only the bridge branch. The skip branches are evidence
   * for why the value-moving leg is booked elsewhere — the consumer must NOT call any lifecycle/strategy method
   * (those carry pricing/external side effects, §4.10).
   */
  private async book(order: LiquidityManagementOrder, marks: LedgerMarkCache): Promise<void> {
    const system = order.action?.system;
    const command = order.action?.command;

    // (4) bridge systems (*Bridge / dEURO bridge-in) → BOOK. Checked FIRST because the dEURO bridge-in command is
    // the one exception to the §4.8 Zweig-1 exchange skip: system=dEURO is otherwise an exchange (Zweig 1), but the
    // bridge-in command is a bridge hop with NO external settlement record → the liquidity_management_order is its
    // own authoritative evidence (D14 §B.5). Resolving Zweig 4 before Zweig 1 keeps the dEURO bridge-in bookable.
    if (this.isBridgeSystem(system, command)) return this.bookBridge(order, marks);

    // (1) exchange-routed transfers/trades (Binance/MEXC/Scrypt/Kraken/XT/Frankencoin/dEURO/Juice) → SKIP.
    // The exchange_tx Deposit/Withdrawal/Trade row is the authoritative settlement record (D14 §B.5); the
    // exchange_tx consumer books it. correlationId(exchange_tx) = LM-order-id (rein lesend, kein double booking).
    if (this.isExchangeSystem(system)) return;

    if (system === LiquidityManagementSystem.DFX_DEX) {
      // (2) DfxDex purchase/sell → SKIP. The liquidity_order (dex) row (txId + feeAmount) is the only authoritative
      // on-chain settlement record (D14 §B.2 proved exchange_tx empty for DfxDex purchase/sell) → booked by the
      // LiquidityOrderDex consumer (§4.8a). Join key: liquidity_order.correlationId == liquidity_management_order.id.
      if (command === 'purchase' || command === 'sell') return;

      // (3) DfxDex withdraw → SKIP. The target exchange_tx Deposit is authoritative (LM correlationId = deposit
      // txId, D14 §B.6) → booked by the exchange_tx consumer. The LM withdraw row is execution detail only.
      if (command === 'withdraw') return;
    }

    // anything else: not a value-moving settlement this consumer owns → skip + log (visible, not silent).
    this.logger.verbose(`liquidity_management_order ${order.id} (system=${system}, command=${command}) → skip`);
  }

  /**
   * §4.8 Zweig 4 — bridge / dEURO bridge-in. The value crosses the bridge as a single asset (same value on two
   * chains); the bridge hop is held by a TRANSIT/bridge/{ccy} account between the two mirror legs. Booking:
   * `Dr ASSET/wallet-target / Cr TRANSIT/bridge/{ccy}` (the arriving target side; the mirror sending side closes
   * the TRANSIT account when its own order settles). Both legs are mark-valued in the SAME mark → Σ CHF = 0, no
   * plug (one currency, L-01).
   */
  private async bookBridge(order: LiquidityManagementOrder, marks: LedgerMarkCache): Promise<void> {
    if (await this.alreadyBooked(order.id)) return; // idempotent re-run

    const targetAsset = order.pipeline?.rule?.targetAsset;
    const amount = order.outputAmount;
    if (!targetAsset || amount == null || amount === 0) {
      this.logger.error(`liquidity_management_order ${order.id} bridge has no target asset / output amount — skip`);
      return;
    }

    const bookingDate = order.updated;
    const ccy = this.currencyOf(targetAsset);

    const wallet = await this.assetAccount(targetAsset);
    const transit = await this.accountService.findOrCreate(`TRANSIT/bridge/${ccy}`, AccountType.TRANSIT, ccy);

    // both legs carry the SAME mark (one currency) → Σ CHF closes to 0 without a spread plug
    const mark = marks.getMarkAt(targetAsset.id, bookingDate);
    const chf = mark != null ? Util.round(mark * amount, 2) : undefined;
    const needsMark = chf == null;

    const legs: LedgerLegInput[] = [
      { account: wallet, amount, priceChf: mark ?? null, amountChf: chf, needsMark },
      {
        account: transit,
        amount: -amount,
        priceChf: mark ?? null,
        amountChf: chf != null ? -chf : undefined,
        needsMark,
      },
    ];

    await this.bookingService.bookTx({
      sourceType: SOURCE_TYPE,
      // sourceId = the stable entity PK (NOT correlationId, which mutates across hops — §4.8 Minor R8-5)
      sourceId: `${order.id}`,
      seq: 0,
      bookingDate,
      valueDate: bookingDate,
      legs,
    });
  }

  // --- HELPERS --- //

  // exchange-routed systems (Binance/MEXC/Scrypt/Kraken/XT/Frankencoin/dEURO/Juice); exchange_tx is authoritative
  private isExchangeSystem(system?: LiquidityManagementSystem): boolean {
    return system != null && LiquidityManagementExchanges.includes(system);
  }

  // bridge systems: the *Bridge family (incl. Boltz) plus the dEURO bridge-in command (system=dEURO is otherwise
  // an exchange system; the bridge-in command is the only dEURO path this consumer books, §4.8 Zweig 4)
  private isBridgeSystem(system?: LiquidityManagementSystem, command?: string): boolean {
    if (system != null && LiquidityManagementBridges.includes(system)) return true;
    return system === LiquidityManagementSystem.DEURO && command === BRIDGE_IN_COMMAND;
  }

  private currencyOf(asset: Asset): string {
    return asset.dexName ?? asset.name;
  }

  private async assetAccount(asset: Asset): Promise<LedgerAccount> {
    const account = await this.accountService.findByAssetId(asset.id);
    if (!account) throw new Error(`ledger account for asset ${asset.id} not found (CoA bootstrap missing)`);
    return account;
  }

  private async alreadyBooked(id: number): Promise<boolean> {
    return (await this.bookingService.nextSeq(SOURCE_TYPE, `${id}`)) > 0;
  }
}
