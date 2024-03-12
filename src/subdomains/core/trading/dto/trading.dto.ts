import { Asset } from 'src/shared/models/asset/asset.entity';

export interface TradingInfo {
  price1: number;
  price2: number;
  priceImpact: number;
  assetIn?: Asset;
  assetOut?: Asset;
  amountIn?: number;
}
