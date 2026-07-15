// Marks a payout failure at or after the actual on-chain broadcast call, i.e. the transaction may
// already be in-flight. Distinguishes this ambiguous case from a provable pre-broadcast failure
// (gas estimation, nonce fetch, gasPrice RPC) so the caller can decide fail-closed vs. auto-retry.
export class PayoutBroadcastException extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PayoutBroadcastException';
  }
}
