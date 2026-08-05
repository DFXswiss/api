import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { FindOptionsWhere } from 'typeorm';
import { PayoutOrder, PayoutOrderStatus } from '../../../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../../../exceptions/payout-broadcast.exception';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutStrategyRegistry } from './payout.strategy-registry';

export abstract class PayoutStrategy implements OnModuleInit, OnModuleDestroy {
  private _feeAsset: Asset;
  private readonly designationLogger = new DfxLogger(PayoutStrategy);

  @Inject() protected readonly pricingService: PricingService;
  @Inject() private readonly registry: PayoutStrategyRegistry;

  onModuleInit() {
    this.registry.add({ blockchain: this.blockchain, assetType: this.assetType }, this);
  }

  onModuleDestroy() {
    this.registry.remove({ blockchain: this.blockchain, assetType: this.assetType });
  }

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract get blockchain(): Blockchain;
  abstract get assetType(): AssetType;

  abstract doPayout(orders: PayoutOrder[]): Promise<void>;
  abstract checkPayoutCompletionData(orders: PayoutOrder[]): Promise<void>;
  abstract estimateFee(targetAsset: Asset, address: string, amount: number, asset: Asset): Promise<FeeResult>;
  abstract estimateBlockchainFee(asset: Asset): Promise<FeeResult>;

  // Returns true if the payout can be safely retried.
  // Uses whitelist approach: only explicitly handled failure types allow retry.
  // Default: false (no retry). Override in specific strategies to handle known failure types.
  async canRetryFailedPayout(_order: PayoutOrder): Promise<boolean> {
    return false;
  }

  // Speedup replaces a pending tx by reusing its nonce; only EVM implements this.
  // Default false so speedupTransaction rejects chains without replacement semantics,
  // which would otherwise broadcast a second, independent transaction (double payout).
  get supportsSpeedup(): boolean {
    return false;
  }

  // Atomically claim the order for this run (see designateBeforeBroadcast). A claim that fails —
  // lost race (affected = 0) or a DB error on the UPDATE itself — leaves the order unclaimed and
  // therefore re-selectable by the next cron run: skipping it here is the self-healing direction,
  // while letting the error escape would run rollback/failure handling on an order this run does
  // not own and stale-overwrite a concurrent run's state.
  // `extraCriteria` pins additional columns the caller read BEFORE the claim and is about to make a
  // decision on. Status alone does not cover that: an order a concurrent run rolled back is
  // PREPARATION_CONFIRMED again, so the claim succeeds while the row has moved on underneath the
  // caller's snapshot. Failing the claim instead leaves the order re-selectable with fresh data.
  protected async claimForBroadcast(
    order: PayoutOrder,
    repo: PayoutOrderRepository,
    extraCriteria: FindOptionsWhere<PayoutOrder> = {},
  ): Promise<boolean> {
    try {
      const result = await repo.update(
        { id: order.id, status: PayoutOrderStatus.PREPARATION_CONFIRMED, ...extraCriteria },
        { status: PayoutOrderStatus.PAYOUT_DESIGNATED },
      );
      if (!result.affected) {
        this.designationLogger.warn(`Skipping payout order ${order.id}: designation lost to a concurrent payout run`);
        return false;
      }

      order.designatePayout();
      return true;
    } catch (e) {
      this.designationLogger.warn(
        `Skipping payout order ${order.id}: designation claim failed, order stays re-selectable`,
        e,
      );
      return false;
    }
  }

  // The payout cron lock expires after 1800 seconds, so payout runs can overlap. An atomic
  // conditional transition prevents a stale run from broadcasting an order already claimed by
  // another run or overwriting its newer payout state; a plain entity save cannot enforce this.
  // A re-entry with payoutTxId already set (EVM manual speedup) keeps its existing status.
  protected async designateBeforeBroadcast(order: PayoutOrder, repo: PayoutOrderRepository): Promise<boolean> {
    if (order.payoutTxId) return true;
    return this.claimForBroadcast(order, repo);
  }

  // Conditionally releases a broadcast order for a fresh protected retry. The WHERE clause pins
  // both status and the exact payoutTxId this run saw, so a stale run cannot roll back an order a
  // concurrent run has already re-claimed or re-broadcast (that would null the fresh payoutTxId
  // and re-open the order for a second broadcast).
  protected async rollbackBroadcastForRetry(order: PayoutOrder, repo: PayoutOrderRepository): Promise<boolean> {
    try {
      // Append the released hash within the pinned update so the replaced tx stays reconstructable
      // from the DB. slice keeps the newest entries; ~30 hashes fit, so overflow is pathological.
      const releasedTxIds = [order.releasedPayoutTxIds, order.payoutTxId].filter((id) => id).join(';');
      const result = await repo.update(
        { id: order.id, status: PayoutOrderStatus.PAYOUT_PENDING, payoutTxId: order.payoutTxId },
        {
          status: PayoutOrderStatus.PREPARATION_CONFIRMED,
          payoutTxId: null,
          releasedPayoutTxIds: releasedTxIds.slice(-2048),
        },
      );
      if (!result.affected) {
        this.designationLogger.warn(`Skipping payout retry for order ${order.id}: state changed concurrently`);
        return false;
      }

      order.releasedPayoutTxIds = releasedTxIds.slice(-2048);
      order.rollbackPayout();
      return true;
    } catch (e) {
      this.designationLogger.warn(`Skipping payout retry for order ${order.id}: rollback claim failed`, e);
      return false;
    }
  }

  // Broadcast-boundary error handling shared by all non-Bitcoin strategies. A PayoutBroadcastException
  // means the send was reached (tx may be in-flight) → fail-closed: leave PAYOUT_DESIGNATED for
  // processFailedOrders → PAYOUT_UNCERTAIN. A plain error means the tx provably never left → roll back
  // to PREPARATION_CONFIRMED for auto-retry, but only on the first attempt (payoutTxId unset — never
  // break manual speedup nonce reuse) and capped by retryCount to escalate a permanent failure.
  protected async handleBroadcastError(order: PayoutOrder, e: unknown, repo: PayoutOrderRepository): Promise<void> {
    const preBroadcast = !(e instanceof PayoutBroadcastException);
    if (preBroadcast && !order.payoutTxId && order.retryCount < Config.payout.maxPreBroadcastRetries) {
      order.recordPayoutFailure(e instanceof Error ? e.message : String(e));
      order.rollbackPayoutDesignation();
      await repo.save(order);
    }
  }

  protected abstract getFeeAsset(): Promise<Asset>;
}
