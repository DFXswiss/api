import { Injectable } from '@nestjs/common';
import { MoneroSignedTxDto } from 'src/integration/blockchain/monero/dto/monero.dto';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { Util } from 'src/shared/utils/util';
import { NotificationService } from 'src/subdomains/supporting/notification/services/notification.service';
import { FindOptionsWhere, IsNull } from 'typeorm';
import { PayoutOrder, PayoutOrderContext, PayoutOrderStatus } from '../../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../../exceptions/payout-broadcast.exception';
import { FeeResult } from '../../../interfaces';
import { PayoutOrderRepository } from '../../../repositories/payout-order.repository';
import { PayoutGroup } from '../../../services/base/payout-bitcoin-based.service';
import { PayoutMoneroService } from '../../../services/payout-monero.service';
import { BitcoinBasedStrategy } from './base/bitcoin-based.strategy';

@Injectable()
export class MoneroStrategy extends BitcoinBasedStrategy {
  protected readonly logger = new DfxLogger(MoneroStrategy);

  private readonly averageTransactionSize = 1600; // Bytes

  // True while a transaction this run signed has no returned relay behind it. Until commit_tx completes
  // the wallet has not marked that transaction's inputs spent — do_not_relay skips commit_tx outright,
  // and a relay whose response was lost throws before set_spent — so getUnlockedBalance still counts
  // them and anything built next is free to select them a second time. Latched on the strategy rather
  // than per context because the contexts of one payout run share a single wallet, and reset for every
  // run in doPayout below.
  //
  // Its bound, stated rather than papered over: it orders the groups WITHIN a run. Payout runs are
  // serial by construction — PayoutService awaits each strategy, the cron holds an in-process lock and
  // a cross-process lease — so two runs only overlap if one exceeds the 1800 s cron timeout inside one
  // process, and a crash loses the flag entirely. Neither leaves a rebuild reachable: the designation
  // claim is pinned on the signed tx, so a stale run cannot rebuild a signed order. What is left is
  // that a run in either of those states can build against a balance that still counts an earlier
  // transaction's inputs, whose worst case is a rejected transaction and stuck orders — recoverable,
  // because the order holds a durable id and retryUncertainPayout can discard a verified-absent one.
  private hasUnrelayedSignedTx = false;

  constructor(
    notificationService: NotificationService,
    protected readonly payoutMoneroService: PayoutMoneroService,
    protected readonly payoutOrderRepo: PayoutOrderRepository,
    protected readonly assetService: AssetService,
  ) {
    super(notificationService, payoutOrderRepo, payoutMoneroService);
  }

  get blockchain(): Blockchain {
    return Blockchain.MONERO;
  }

  get assetType(): AssetType {
    return undefined;
  }

  async estimateFee(): Promise<FeeResult> {
    const feeRate = await this.payoutMoneroService.getEstimatedFee();
    const feeAmount = this.averageTransactionSize * feeRate;

    return { asset: await this.feeAsset(), amount: feeAmount };
  }

  // The only entry point that spans this run's contexts, and therefore where the shared-wallet latch
  // belongs. It is reset rather than carried over: a fresh run re-reads the orders, so an unrelayed
  // transaction still open from last time comes back through the resume path above.
  async doPayout(orders: PayoutOrder[]): Promise<void> {
    this.hasUnrelayedSignedTx = false;

    await super.doPayout(orders);
  }

  protected async doPayoutForContext(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    // Resume before building anything. An order that already carries a signed transaction must be
    // re-RELAYED, never rebuilt: a built-but-unrelayed transaction reserves nothing in the wallet (no
    // pending entry, no spent key images), so a rebuild would re-select the same inputs and race a
    // second transaction over them — the double-spend #4238 exists to prevent. Resuming is grouped by
    // the signed tx id so every order that transaction pays travels together and lands on the same
    // payoutTxId; regrouping the survivors would relay a transaction paying orders no longer tracked.
    // No unlocked-balance gate here either: that gate exists to avoid building a transaction the wallet
    // cannot fund, and these inputs were selected when the transaction was built.
    const [signedOrders, unsignedOrders] = Util.partition(orders, (o) => Boolean(o.signedPayoutTxId));

    for (const [signedTxId, group] of Util.groupBy<PayoutOrder, string>(signedOrders, 'signedPayoutTxId')) {
      try {
        await this.sendXMR(context, group);
      } catch (e) {
        this.logger.error(`Error relaying signed XMR tx ${signedTxId}. Order ID(s): ${group.map((o) => o.id)}:`, e);
      }
    }

    const pendingOrders = [...unsignedOrders];
    let paidOutOrders = 0;

    while (pendingOrders.length > 0) {
      // Do not start a second transaction while the first one's relay is still open. getUnlockedBalance
      // reads the wallet, and the wallet has not marked that transaction's inputs spent — so it would
      // hand the same outputs out twice and the two transactions would race for them. Waiting a round
      // costs 30 s; the next one resumes the relay first, and a relay that returns runs set_spent.
      if (this.hasUnrelayedSignedTx) {
        this.logger.info(
          `XMR payout: deferring ${pendingOrders.length} order(s), a signed tx has no relay behind it yet`,
        );
        break;
      }

      const unlockedBalance = await this.payoutMoneroService.getUnlockedBalance();
      if (unlockedBalance <= 0) break;

      const group = this.splicePayoutGroup(pendingOrders, unlockedBalance, 15);
      if (group.length === 0) break;

      try {
        await this.sendXMR(context, group);
        // Count what actually went out: `send` swallows a pre-broadcast failure and returns normally,
        // so the group size would report a rolled-back group as paid during the very incident that
        // needs surfacing.
        paidOutOrders += group.filter((o) => o.status === PayoutOrderStatus.PAYOUT_PENDING).length;
      } catch (e) {
        this.logger.error(`Error paying out XMR orders`, e);
        break;
      }
    }

    if (paidOutOrders > 0 || pendingOrders.length > 0) {
      this.logger.info(
        `XMR payout: ${paidOutOrders} paid, ${pendingOrders.length} pending (insufficient unlocked balance)`,
      );
    }
  }

  private splicePayoutGroup(orders: PayoutOrder[], maxAmount: number, maxSize: number): PayoutOrder[] {
    let total = 0;
    let count = 0;

    for (const order of orders) {
      if (count >= maxSize) break;
      if (total + order.amount > maxAmount) break;

      total += order.amount;
      count++;
    }

    return orders.splice(0, count);
  }

  // Monero deliberately has no atomic dispatch. `transfer` builds, signs and relays in one call, and its
  // -38 then cannot be attributed to a phase — which is the whole reason for the split below. Kept as an
  // explicit trap rather than an unreachable delegation: routing Monero back through the atomic call
  // would silently reinstate the ambiguity #4673 removes, so it must fail loudly instead.
  protected dispatchPayout(): Promise<string> {
    throw new Error('Monero payouts are broadcast via broadcastPayout (build + relay), not dispatchPayout');
  }

  // The build/relay split (#4673). Build and sign without relaying, persist the resulting tx id and its
  // relay metadata on every designated order, and only then relay. A build failure therefore reserves
  // nothing and stays a plain retryable error; a relay failure arrives with an id that is already final.
  protected async broadcastPayout(
    _context: PayoutOrderContext,
    payout: PayoutGroup,
    designated: PayoutOrder[],
  ): Promise<string> {
    const resumed = this.resumeSignedTx(designated);
    // Latched before the lookup, not after it: a hit means the earlier relay reached the daemon but
    // lost its response, and commit_tx throws on that response — before set_spent. The wallet's
    // balance stays overstated until the transaction confirms, so this run must not build against it.
    if (resumed) this.hasUnrelayedSignedTx = true;

    // Look up a resumed transaction before relaying it again: the earlier relay may well have reached
    // the daemon and only lost its response, in which case the transaction is already in the pool under
    // this exact id and the order is decided without a second submission. A miss — or an unreachable
    // daemon — costs nothing, because relay_tx re-submits the identical transaction under the identical
    // id. This is the lookup that replaces the operator's wallet-log forensics.
    if (resumed && (await this.isRelayed(resumed.txId))) return resumed.txId;

    const signedTx = resumed ?? (await this.signPayout(payout, designated));

    try {
      const relayedTxId = await this.payoutMoneroService.relayTransfer(signedTx.metadata);
      // A relay that returned ran commit_tx to completion, so set_spent has fired and the wallet's
      // unlocked balance is honest again — the next group may be built.
      this.hasUnrelayedSignedTx = false;

      return relayedTxId;
    } catch (e) {
      if (!(e instanceof PayoutBroadcastException)) throw e;

      // The relay is fail-closed by default because a retry there used to mean a REBUILD over the same
      // inputs. It no longer does: this transaction is signed and both its id and its metadata are on
      // disk, so the retry re-submits this exact transaction (relay_tx -> commit_tx on the same
      // pending_tx) and can only ever produce this exact id. Downgrading to a plain error therefore
      // rolls the order back for the bounded auto-retry above — which starts with a lookup — instead of
      // parking a decidable order for a human. The guard is not decoration: without the persisted
      // metadata the retry WOULD be a rebuild, and then the fail-closed escalation is the correct
      // outcome. maxPreBroadcastRetries still caps the loop, so PayoutUncertain remains the backstop.
      if (!designated.every((o) => o.signedPayoutTxId === signedTx.txId && o.signedPayoutTxMetadata)) throw e;

      throw new Error(`${e.message} (signed XMR tx ${signedTx.txId}, relay unconfirmed)`, { cause: e });
    }
  }

  async getFeeAsset(): Promise<Asset> {
    return this.assetService.getMoneroCoin();
  }

  private async sendXMR(context: PayoutOrderContext, orders: PayoutOrder[]): Promise<void> {
    await this.send(context, orders);
  }

  // Rebuild-vs-resume is decided from the orders this run queried, and a concurrent run can invalidate
  // that snapshot before the claim lands: it may sign a transaction for one of them, fail to relay it
  // and roll the order back to PREPARATION_CONFIRMED, all of which a status-only claim happily wins.
  // This run would then see its stale "no signed tx" copy and REBUILD over inputs the signed
  // transaction never reserved. Pinning the snapshot's view of the signed tx into the claim makes the
  // row itself the authority: an order that has moved on is left to the next round's resume path.
  //
  // It also closes the write channel from the other side - only a claim winner ever calls save(), and
  // a claim winner's copy of these two columns now provably matches the row, so a full-entity save
  // cannot null a live signed tx out (TypeORM writes null values, it only skips undefined ones).
  protected async designatePayout(orders: PayoutOrder[]): Promise<PayoutOrder[]> {
    const designated: PayoutOrder[] = [];

    for (const order of orders) {
      const signedTx: FindOptionsWhere<PayoutOrder> = { signedPayoutTxId: order.signedPayoutTxId ?? IsNull() };
      if (await this.claimForBroadcast(order, this.payoutOrderRepo, signedTx)) designated.push(order);
    }

    return designated;
  }

  private resumeSignedTx(designated: PayoutOrder[]): MoneroSignedTxDto | undefined {
    // doPayoutForContext hands resumable orders over one signed transaction at a time, so the first
    // order speaks for the group. An id without metadata cannot be relayed and must not be resumed:
    // that would silently fall through to a rebuild of a transaction whose id is already recorded.
    const [{ signedPayoutTxId, signedPayoutTxMetadata }] = designated;

    return signedPayoutTxId && signedPayoutTxMetadata
      ? { txId: signedPayoutTxId, metadata: signedPayoutTxMetadata }
      : undefined;
  }

  // Build, sign, and persist — in that order, with persisting a precondition for relaying rather than a
  // side effect of it. Without the id on disk a relay failure is exactly the inference this split
  // removes, so a failed persist throws and no relay is attempted.
  //
  // One unconditional statement over the whole group, on purpose. It must be all-or-nothing: an order
  // the transaction pays but has no record of would later be rebuilt into a SECOND payment to the same
  // address. And it is deliberately not conditioned on status — an order this run claimed but that a
  // concurrent escalation has since moved to PayoutUncertain still needs the record, precisely so that
  // its eventual manual retry re-relays instead of rebuilding.
  private async signPayout(payout: PayoutGroup, designated: PayoutOrder[]): Promise<MoneroSignedTxDto> {
    const signedTx = await this.payoutMoneroService.buildTransfer(payout);
    // Latched on the build, not on the persist: a transaction that was signed but not recorded still
    // holds unreserved inputs in the wallet, and a partial persist even leaves rows that will resume it.
    this.hasUnrelayedSignedTx = true;

    const result = await this.payoutOrderRepo.update(
      designated.map((o) => o.id),
      { signedPayoutTxId: signedTx.txId, signedPayoutTxMetadata: signedTx.metadata },
    );
    if (result.affected !== designated.length)
      throw new Error(
        `Signed XMR tx ${signedTx.txId} persisted for ${result.affected} of ${designated.length} order(s), not relaying`,
      );

    designated.forEach((o) => o.recordSignedPayoutTx(signedTx.txId, signedTx.metadata));

    return signedTx;
  }

  // Presence, not confirmation — a transaction in the daemon's pool has provably been relayed. A lookup
  // failure is reported as "unknown" rather than propagated: the fallback is a re-relay of the identical
  // transaction, which is safe either way, and propagating would turn a working payout into a failure.
  private async isRelayed(txId: string): Promise<boolean> {
    try {
      return await this.payoutMoneroService.isTxKnown(txId);
    } catch (e) {
      this.logger.warn(`Could not look up signed XMR tx ${txId}, re-relaying instead:`, e);
      return false;
    }
  }
}
