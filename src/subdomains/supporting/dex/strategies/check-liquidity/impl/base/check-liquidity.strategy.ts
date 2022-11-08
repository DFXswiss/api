import { Asset } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';

export abstract class CheckLiquidityStrategy {
  private _feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
