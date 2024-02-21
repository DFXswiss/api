import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { FeeResult } from 'src/subdomains/supporting/payout/interfaces';
import { PayoutOrder } from '../../../../entities/payout-order.entity';
import { PrepareStrategyRegistry } from './prepare.strategy-registry';

export abstract class PrepareStrategy implements OnModuleInit, OnModuleDestroy {
  private _feeAsset: Asset;

  @Inject()
  private readonly registry: PrepareStrategyRegistry;

  onModuleInit() {
    this.registry.add(this.blockchain, this);
  }

  onModuleDestroy() {
    this.registry.remove(this.blockchain);
  }

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract get blockchain(): Blockchain;

  abstract preparePayout(orders: PayoutOrder[]): Promise<void>;
  abstract checkPreparationCompletion(orders: PayoutOrder[]): Promise<void>;
  abstract estimateFee(asset: Asset): Promise<FeeResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
