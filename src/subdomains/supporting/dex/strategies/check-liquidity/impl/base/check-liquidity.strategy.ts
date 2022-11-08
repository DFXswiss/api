import { Asset } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';

export abstract class CheckLiquidityStrategy {
  private _feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    if (!this._feeAsset) {
      this._feeAsset = await this.getFeeAsset();
    }

    return this._feeAsset;
  }

  abstract checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
