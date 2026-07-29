import { Active } from 'src/shared/models/active';
import { Asset } from 'src/shared/models/asset/asset.entity';
import { LiquidityBalance } from '../entities/liquidity-balance.entity';
import { LiquidityManagementOrder } from '../entities/liquidity-management-order.entity';
import { LiquidityManagementContext, LiquidityOptimizationType, UncertainOrderResolution } from '../enums';

export type CorrelationId = string;
export type PipelineId = number;
export type Command = (order: LiquidityManagementOrder) => Promise<CorrelationId>;
export type LiquidityManagementAsset = Asset & { context: LiquidityManagementContext };

export interface LiquidityBalanceIntegration {
  getBalances(assets: Active[]): Promise<LiquidityBalance[]>;
  hasPendingOrders(asset: Active, context: LiquidityManagementContext): Promise<boolean>;
}

export interface LiquidityActionIntegration {
  supportedCommands: string[];
  executeOrder(order: LiquidityManagementOrder): Promise<CorrelationId>;
  checkCompletion(order: LiquidityManagementOrder): Promise<boolean>;
  validateParams(command: string, params: Record<string, unknown>): boolean;

  /**
   * Venue-side reference to claim before the request is sent, so an un-acknowledged request stays
   * traceable. Optional: integrations that derive their correlationId from the venue's response (or encode
   * their own state into it) omit this and keep the existing behaviour.
   */
  reserveCorrelationId?(order: LiquidityManagementOrder): CorrelationId;

  /**
   * Ask the venue what happened to an order quarantined as UNCERTAIN. Must never re-send the request —
   * it may only observe. Integrations that cannot look an order up omit this; their orders stay in
   * quarantine for a human to resolve.
   */
  resolveUncertainOrder?(order: LiquidityManagementOrder): Promise<UncertainOrderResolution>;

  /**
   * Make sure nothing this order put on the wire can still execute, so it may be given up safely.
   *
   * The one thing that makes abandoning a quarantined order dangerous is a request still live at the venue:
   * give the rule its funds back and a late fill spends them twice. Rather than estimating when that can no
   * longer happen, this removes the possibility — cancelling is the opposite of re-sending, so it is the one
   * write that is always safe against an outcome nobody could observe.
   *
   * Returns true only when the venue has CONFIRMED there is nothing left to execute. An unconfirmed cancel
   * must return false: it may well have taken effect, but "may well" is what quarantine already means.
   * Integrations that cannot cancel omit this, and their orders keep waiting for a person.
   */
  cancelOutstanding?(order: LiquidityManagementOrder): Promise<boolean>;
}

export interface LiquidityState {
  action: LiquidityOptimizationType | null;
  minAmount: number;
  maxAmount: number;
}
