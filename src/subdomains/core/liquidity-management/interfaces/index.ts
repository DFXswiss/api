import { Asset } from 'src/shared/models/asset/asset.entity';
import { Fiat } from 'src/shared/models/fiat/fiat.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';

export type CorrelationId = string;
export type PipelineId = number;
export type Command = (order: LiquidityManagementOrder) => Promise<CorrelationId>;

export interface LiquidityBalanceIntegration {
  getBalances(assets: (Asset | Fiat)[]): Promise<LiquidityBalance[]>;
  getNumberOfPendingOrders(asset: Asset | Fiat): Promise<number>;
}

export interface LiquidityActionIntegration {
  supportedCommands: string[];
  executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId>;
  checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;
  validateParams(command: string, params: Record<string, unknown>): boolean;
}

export interface LiquidityState {
  deficit: number;
  redundancy: number;
}
