import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Config } from 'src/config/config';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder, PayoutOrderStatus } from '../../../../entities/payout-order.entity';
import { PayoutBroadcastException } from '../../../../exceptions/payout-broadcast.exception';
import { PayoutOrderRepository } from '../../../../repositories/payout-order.repository';
import { PayoutStrategyRegistry } from './payout.strategy-registry';

export abstract class PayoutStrategy implements OnModuleInit, OnModuleDestroy {
  private _feeAsset: Asset;

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

  // The payout cron lock expires after 1800 seconds, so payout runs can overlap. An atomic
  // conditional transition prevents a stale run from broadcasting an order already claimed by
  // another run or overwriting its newer payout state; a plain entity save cannot enforce this.
  // A re-entry with payoutTxId already set (EVM speedup/expired-retry) keeps its existing status.
  protected async designateBeforeBroadcast(order: PayoutOrder, repo: PayoutOrderRepository): Promise<boolean> {
    if (order.payoutTxId) return true;

    const result = await repo.update(
      { id: order.id, status: PayoutOrderStatus.PREPARATION_CONFIRMED },
      { status: PayoutOrderStatus.PAYOUT_DESIGNATED },
    );
    if (!result.affected) return false;

    order.designatePayout();
    return true;
  }

  // Broadcast-boundary error handling shared by all non-Bitcoin strategies. A PayoutBroadcastException
  // means the send was reached (tx may be in-flight) → fail-closed: leave PAYOUT_DESIGNATED for
  // processFailedOrders → PAYOUT_UNCERTAIN. A plain error means the tx provably never left → roll back
  // to PREPARATION_CONFIRMED for auto-retry, but only on the first attempt (payoutTxId unset — never
  // break speedup/expired-retry nonce reuse) and capped by retryCount to escalate a permanent failure.
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
