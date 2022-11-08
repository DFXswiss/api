import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';

export interface LiquidityBalanceProvider {
  getBalance(asset: Asset | Fiat): Promise<LiquidityBalance>;
}

export interface LiquidityProcessor {
  target: Asset | Fiat;

  buy(amount: number): Promise<void>;
  sell(amount: number): Promise<void>;
}

export interface LiquidityVerificationResult {
  isOptimal: boolean;
  liquidityDeficit: number;
  liquidityRedundancy: number;
}
