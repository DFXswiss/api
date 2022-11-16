import { Asset } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityRequest, CheckLiquidityResult } from '../../../../interfaces';

export abstract class CheckLiquidityStrategy {
  private _feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    return (this._feeAsset ??= await this.getFeeAsset());
  }

  abstract checkLiquidity(request: CheckLiquidityRequest): Promise<CheckLiquidityResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
