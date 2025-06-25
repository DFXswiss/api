import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { DfxLogger } from 'src/logger/dfx-logger.service';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { SellLiquidityRequest } from '../../../../interfaces';
import { SellLiquidityStrategyRegistry } from './sell-liquidity.strategy-registry';

export abstract class SellLiquidityStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  private _feeAsset: Asset;

  @Inject() private readonly registry: SellLiquidityStrategyRegistry;

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

  abstract sellLiquidity(request: SellLiquidityRequest): Promise<void>;
  abstract addSellData(order: LiquidityOrder): Promise<void>;
  protected abstract getFeeAsset(): Promise<Asset>;

  protected async handleSellLiquidityError(request: SellLiquidityRequest, e: Error): Promise<void> {
    const errorMessage = `Error while trying to sell liquidity of ${request.sellAsset.uniqueName}`;
    this.logger.error(`${errorMessage}:`, e);

    throw new Error(errorMessage);
  }
}
