import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { FiatService } from 'src/shared/models/fiat/fiat.service';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PricingService } from 'src/subdomains/supporting/pricing/services/pricing.service';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PayoutStrategyRegistry } from './payout.strategy-registry';

export abstract class PayoutStrategy implements OnModuleInit, OnModuleDestroy {
  private _feeAsset: Asset;
  protected chf: Fiat;

  @Inject() protected readonly pricingService: PricingService;
  @Inject() protected readonly fiatService: FiatService;
  @Inject() private readonly registry: PayoutStrategyRegistry;

  onModuleInit() {
    this.registry.add({ blockchain: this.blockchain, assetType: this.assetType }, this);
    void this.fiatService.getFiatByName('CHF').then((f) => (this.chf = f));
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

  protected abstract getFeeAsset(): Promise<Asset>;
}
