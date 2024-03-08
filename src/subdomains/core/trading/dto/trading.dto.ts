import { Token } from '@uniswap/sdk-core';
import { Asset } from 'src/shared/models/asset/asset.entity';

export interface PoolBalanceDto {
  token0: Token;
  balance0: number;
  token1: Token;
  balance1: number;
}

export interface TradingInfoDto {
  price1: number;
  price2: number;
  priceImpact: number;
  assetIn?: Asset;
  assetOut?: Asset;
  amountIn?: number;
}
