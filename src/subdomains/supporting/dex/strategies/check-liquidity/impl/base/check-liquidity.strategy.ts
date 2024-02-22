import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../../interfaces';
import { CheckLiquidityStrategyRegistry } from './check-liquidity.strategy-registry';

export abstract class CheckLiquidityStrategy implements OnModuleInit, OnModuleDestroy {
  private _feeAsset: Asset;

  @Inject()
  private readonly registry: CheckLiquidityStrategyRegistry;

  onModuleInit() {
    this.registry.add(
      { blockchain: this.blockchain, assetType: this.assetType, assetCategory: this.assetCategory },
      this,
    );
  }

  onModuleDestroy() {
    this.registry.remove({
      blockchain: this.blockchain,
      assetType: this.assetType,
      assetCategory: this.assetCategory,
    });
  }

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract get blockchain(): Blockchain;
  abstract get assetType(): AssetType;
  abstract get assetCategory(): AssetCategory;

  abstract checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
