import { LiquidityOrder } from 'src/subdomains/supporting/dex/entities/liquidity-order.entity';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { SellLiquidityRequest } from '../../../../interfaces';
import { SellLiquidityStrategyAlias } from '../../sell-liquidity.facade';

export abstract class SellLiquidityStrategy {
  private _name: SellLiquidityStrategyAlias;
  private _feeAsset: Asset;

  constructor(name: SellLiquidityStrategyAlias) {
    this._name = name;
  }

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract sellLiquidity(request: SellLiquidityRequest): Promise<void>;
  abstract addSellData(order: LiquidityOrder): Promise<void>;
  protected abstract getFeeAsset(): Promise<Asset>;

  protected async handleSellLiquidityError(request: SellLiquidityRequest, e: Error): Promise<void> {
    const errorMessage = `Error while trying to sell liquidity of ${request.sellAsset.uniqueName}`;
    console.error(errorMessage, e);

    throw new Error(errorMessage);
  }

  //*** GETTERS ***//

  get name(): string {
    return this._name;
  }
}
