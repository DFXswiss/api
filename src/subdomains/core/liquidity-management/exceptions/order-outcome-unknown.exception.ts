/**
 * The request left our side but we never observed its outcome — the venue may or may not have acted on it.
 *
 * This is deliberately NOT `OrderFailedException`. `Failed` asserts knowledge ("it demonstrably did not
 * happen") and, because a failed pipeline pauses its rule and the rule auto-reactivates after
 * `reactivationTime`, it also means "try the same thing again in a few minutes". Applying that to an
 * ambiguous outcome is how a single un-acknowledged request turns into a double execution.
 *
 * Orders that end here are quarantined in `LiquidityManagementOrderStatus.UNCERTAIN` and resolved by
 * asking the venue what actually happened — never by repeating the request. Mirrors the payout
 * subdomain's `PayoutBroadcastException` / `PAYOUT_UNCERTAIN` pair, which solves the same problem for
 * blockchain broadcasts.
 */
export class OrderOutcomeUnknownException extends Error {
  constructor(message: string) {
    super(message);
  }
}
