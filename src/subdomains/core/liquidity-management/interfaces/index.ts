import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';

export type CorrelationId = string;
export type PipelineId = number;
export type Command = (target: Asset | Fiat, amount: number, correlationId: number) => Promise<CorrelationId>;

export interface LiquidityBalanceIntegration {
  getBalance(asset: Asset | Fiat): Promise<LiquidityBalance>;
}

export interface LiquidityActionIntegration {
  supportedCommands: string[];
  executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId>;
  checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;
}

export interface LiquidityState {
  deficit: number;
  redundancy: number;
}
