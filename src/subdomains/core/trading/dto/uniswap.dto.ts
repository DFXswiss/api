import { Asset } from 'src/shared/models/asset/asset.entity';

export interface UniswapPoolBalanceDto {
  token0: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    balance: number;
  };
  token1: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    balance: number;
  };
}

export interface UniswapPoolTradingInfoDto {
  source1: {
    name: string;
    leftAsset: string;
    rightAsset: string;
    price: number;
  };
  source2: {
    name: string;
    leftAsset: string;
    rightAsset: string;
    price: number;
  };
  swap: {
    priceImpact: number;
    assetIn?: Asset;
    assetOut?: Asset;
    amountIn?: number;
  };
}
