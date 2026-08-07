// Marks a transaction that reached the chain and REVERTED, as opposed to one that cannot be read
// yet. The distinction is the whole point: a revert is final and re-checking it forever is
// pointless, while an RPC timeout or a gateway error says nothing about the transaction at all and
// must be retried. Both used to arrive as a bare `Error`, so a caller could only tell them apart by
// matching the message text — which silently stops working the moment the wording changes.
//
// The message is deliberately identical to the one thrown before this type existed, and the class
// extends `Error`, so every existing caller that only logs or only catches keeps behaving exactly
// as it did. Only a caller that asks `instanceof` sees anything new.
export class TransactionRevertedException extends Error {
  constructor(txHash: string) {
    super(`Transaction ${txHash} has failed`);
    this.name = 'TransactionRevertedException';
  }
}
