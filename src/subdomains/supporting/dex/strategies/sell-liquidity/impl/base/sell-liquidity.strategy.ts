import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Blockchain } from 'src/integration/blockchain/shared/enums/blockchain.enum';
import { Asset, AssetType } from 'src/shared/models/asset/asset.entity';
import { DfxLogger } from 'src/shared/services/dfx-logger';
import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { SellLiquidityRequest } from '../../../../interfaces';
import { SellLiquidityStrategyRegistry } from './sell-liquidity.strategy-registry';

export abstract class SellLiquidityStrategy implements OnModuleInit, OnModuleDestroy {
  protected abstract readonly logger: DfxLogger;

  private _name: string;
  private _feeAsset: Asset;

  @Inject()
  private readonly registry: SellLiquidityStrategyRegistry;

  constructor(name: string) {
    this._name = name;
  }

  onModuleInit() {
    this.registry.addStrategy({ blockchain: this.blockchain, assetType: this.assetType }, this);
  }

  onModuleDestroy() {
    this.registry.removeStrategy({ blockchain: this.blockchain, assetType: this.assetType });
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

  //*** GETTERS ***//

  get name(): string {
    return this._name;
  }
}
