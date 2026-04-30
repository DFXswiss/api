import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
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

  protected abstract getFeeAsset(): Promise<Asset>;
}
