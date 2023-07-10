import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetCategory, AssetType } from 'src/shared/models/asset/asset.entity';
import { AssetService } from 'src/shared/models/asset/asset.service';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../../interfaces';
import { PurchaseLiquidityStrategyRegistry } from '../../../purchase-liquidity/impl/base/purchase-liquidity.strategy-registry';
import { CheckLiquidityStrategyRegistry } from './check-liquidity.strategy-registry';

export abstract class CheckLiquidityStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  private _feeAsset: Asset;

  @Inject() protected readonly assetService: AssetService;
  @Inject() private readonly registry: CheckLiquidityStrategyRegistry;
  @Inject() private readonly purchaseRegistry: PurchaseLiquidityStrategyRegistry;

  onModuleInit() {
    this.registry.addStrategy(
      { blockchain: this.blockchain, assetType: this.assetType, assetCategory: this.assetCategory },
      this,
    );
  }

  onModuleDestroy() {
    this.registry.removeStrategy({
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

  protected async getPrioritySwapAssets(targetAsset: Asset): Promise<Asset[]> {
    try {
      const purchaseStrategy = this.purchaseRegistry.getPurchaseLiquidityStrategy(targetAsset);

      if (!purchaseStrategy) return [];

      return await purchaseStrategy.swapAssets();
    } catch (e) {
      this.logger.warn(`Error while getting priority assets for ${targetAsset.uniqueName}:`, e);

      return [];
    }
  }
}
