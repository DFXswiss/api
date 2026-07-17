// Thrown by a content-change scan callback (§4.7 G-a) when a late-settling row's opening (received/paymentLink) is not
// yet booked — a DESIGNED self-healing retry signal (leave the cursor, re-scan next run), NOT a failure.
// runContentChangeScan catches it and logs at verbose instead of error so an expected gate-block does not spam ERROR
// every cron cycle; every OTHER throw stays a genuine scan error at error level.
export class LedgerGateBlockedError extends Error {
  constructor(message: string) {
    super(message);
  }
}
