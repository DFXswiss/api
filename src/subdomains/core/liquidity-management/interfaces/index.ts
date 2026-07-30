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
   * request kind (a Scrypt withdrawal), the substitute is weaker and knowingly so: the venue answered and did
   * not name the reference, with no completeness check on that answer.
   *
   * Returns a non-empty reason string only when the venue has answered that nothing under this order is left
   * to execute (or, for a withdrawal, that its full history has no record of it). The caller writes that
   * string into the order and the log as-is — each integration supplies its own wording so the pipeline never
   * invents a reason the venue never gave. `null` means no automatic exit; the order stays quarantined.
   * Read "answered" precisely: a cancellation it accepts, an order it reports terminal, or a successful
   * history reply that omits the withdrawal reference settles the question. An unconfirmed cancel must return
   * null: it may well have taken effect, but "may well" is what quarantine already means. A truncated history
   * is deliberately NOT rejected for withdrawals — that trade-off, and why the alternative was worse, is
   * argued where the check lives.
   * Integrations that cannot cancel omit this and simply have no automatic exit from quarantine. For Scrypt,
   * reconciliation reaches the adapter by system (not by registered command), so every command — including
   * one no longer in `supportedCommands` — gets either a venue-confirmed reason string or `null`. Known
   * trade/withdraw commands cancel or confirm absence as before; an unsupported command asks `getOrderStatus`
   * per reference and cancels any non-terminal one under the symbol that reply itself carries — so "no
   * derivable symbol" is not a reason to wait. Neither path waits on an operator as its way out.
   */
  cancelOutstanding?(order: LiquidityManagementOrder): Promise<string | null>;
}

export interface LiquidityState {
  action: LiquidityOptimizationType | null;
  minAmount: number;
  maxAmount: number;
}
