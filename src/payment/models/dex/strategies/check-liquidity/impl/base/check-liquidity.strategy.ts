import { Asset } from 'src/shared/models/asset/asset.entity';
import { CheckLiquidityResult, LiquidityRequest } from '../../../../interfaces';

export abstract class CheckLiquidityStrategy {
  #feeAsset: Asset;

  async feeAsset(): Promise<Asset> {
    return this.#feeAsset ?? (await this.getFeeAsset());
  }

  abstract checkLiquidity(request: LiquidityRequest): Promise<CheckLiquidityResult>;
  protected abstract getFeeAsset(): Promise<Asset>;
}
