import { FeeAmount } from '@uniswap/v3-sdk';
import { Asset } from 'src/shared/models/asset/asset.entity';

export interface TradingInfo {
  price1: number;
  price2: number;
  price3: number;
  priceImpact: number;
  poolFee: FeeAmount;
  assetIn?: Asset;
  assetOut?: Asset;
  amountIn?: number;
  amountExpected?: number;
  tradeRequired: boolean;
  message?: string;
}
