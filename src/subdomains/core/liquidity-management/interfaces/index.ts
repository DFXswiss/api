import { Active } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementContext } from '../enums';

export type CorrelationId = string;
export type PipelineId = number;
export type Command = (order: LiquidityManagementOrder) => Promise<CorrelationId>;
export type LiquidityManagementActive = Active & { context: LiquidityManagementContext };
export type LiquidityManagementAsset = Asset & { context: LiquidityManagementContext };

export interface LiquidityBalanceIntegration {
  getBalances(assets: Active[]): Promise<LiquidityBalance[]>;
  getNumberOfPendingOrders(asset: Active, context: LiquidityManagementContext): Promise<number>;
}

export interface LiquidityActionIntegration {
  supportedCommands: string[];
  executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId>;
  checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;
  validateParams(command: string, params: Record<string, unknown>): boolean;
}

export interface LiquidityState {
  deficit: number;
  minDeficit: number;
  redundancy: number;
}
