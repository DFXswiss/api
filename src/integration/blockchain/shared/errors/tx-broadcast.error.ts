// Generic marker for a failure of the actual on-chain send call (wallet.sendTransaction /
// contract.transfer). Deliberately not payout-specific - this client is shared by dex, payin and
// faucet callers too, which keep catching plain Error via catch(e) and logging e.message.
export class TxBroadcastError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TxBroadcastError';
  }
}
