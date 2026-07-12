import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
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

  // Persist PAYOUT_DESIGNATED BEFORE broadcasting (fail-closed, mirrors the Bitcoin path):
  // a reboot between broadcast and save must not leave the order re-selectable by the payout
  // cron, which would double-pay. Only designates on the first attempt; a re-entry with
  // payoutTxId already set (EVM speedup/expired-retry) keeps its status so nonce reuse stays intact.
  protected async designateBeforeBroadcast(order: PayoutOrder, repo: PayoutOrderRepository): Promise<void> {
    if (!order.payoutTxId) {
      order.designatePayout();
      await repo.save(order);
    }
  }

  protected abstract getFeeAsset(): Promise<Asset>;
}
