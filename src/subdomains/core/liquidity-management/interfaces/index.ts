import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';

export type CorrelationId = string;

export interface LiquidityBalanceIntegration {
  getBalance(asset: Asset | Fiat): Promise<LiquidityBalance>;
}

export interface LiquidityActionIntegration {
  supportedCommands: string[];
  executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId>;
  checkCompletion(correlationId: string): Promise<boolean>;
}

export interface LiquidityVerificationResult {
  isOptimal: boolean;
  liquidityDeficit: number;
  liquidityRedundancy: number;
}
