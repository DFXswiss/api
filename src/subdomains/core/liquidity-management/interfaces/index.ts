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
   * Make sure nothing this order has claimed — sent or merely reserved — can still execute, so it may be
   * given up safely.
   *
   * The one thing that makes abandoning a quarantined order dangerous is a request still live at the venue:
   * give the rule its funds back and a late fill spends them twice. Rather than estimating when that can no
   * longer happen, this removes the possibility — cancelling is the opposite of re-sending, so it is the one
   * write that is always safe against an outcome nobody could observe. Where the venue has no cancel for the
   * request kind (a Scrypt withdrawal), the equivalent is a confirmed absence from a complete history.
   *
   * Returns a non-empty reason string only when the venue has answered that nothing under this order is left
   * to execute (or, for a withdrawal, that its full history has no record of it). The caller writes that
   * string into the order and the log as-is — each integration supplies its own wording so the pipeline never
   * invents a reason the venue never gave. `null` means no automatic exit; the order stays quarantined.
   * Read "answered" precisely: a cancellation it accepts, an order it reports terminal, or a complete history
   * that omits the withdrawal reference settles the question. An unconfirmed cancel, incomplete history, or
   * failed consistency check must return null: it may well have taken effect, but "may well" is what
   * quarantine already means.
   * Integrations that cannot cancel omit this and simply have no automatic exit from quarantine. For Scrypt
   * every command (trade and withdraw) implements this path — neither waits on an operator as its way out.
   */
  cancelOutstanding?(order: LiquidityManagementOrder): Promise<string | null>;
}

export interface LiquidityState {
  action: LiquidityOptimizationType | null;
  minAmount: number;
  maxAmount: number;
}
