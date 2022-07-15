import { Asset } from 'src/shared/models/asset/asset.entity';

export interface PurchaseLiquidityStrategy {
  purchase(asset: Asset, referenceAsset: string, referenceAmount: number): Promise<string>;
}
