import { Asset } from 'src/shared/models/asset/asset.entity';
import { PurchaseLiquidityStrategy } from './purchase-liquidity.interface';

export class PurchaseDTokenStrategy implements PurchaseLiquidityStrategy {
  async purchase(asset: Asset, referenceAsset: string, referenceAmount: number): Promise<string> {
    return '';
  }
}
