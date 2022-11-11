import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';

export interface LiquidityBalanceIntegration {
  getBalance(asset: Asset | Fiat): Promise<LiquidityBalance>;
}

export interface LiquidityActionIntegration {
  target: Asset | Fiat;

  runCommand(command: string): Promise<void>;
  checkCompletion(): Promise<boolean>;
}

export interface LiquidityVerificationResult {
  isOptimal: boolean;
  liquidityDeficit: number;
  liquidityRedundancy: number;
}
