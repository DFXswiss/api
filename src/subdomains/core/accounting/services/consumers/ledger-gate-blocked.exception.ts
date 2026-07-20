// Thrown by a content-change scan callback (§4.7 G-a) when a late-settling row's opening (received/paymentLink) is not
// yet booked — a DESIGNED self-healing retry signal (leave the cursor, re-scan next run), NOT a failure.
// runContentChangeScan catches it and logs at verbose instead of error so an expected gate-block does not spam ERROR
// every cron cycle; every OTHER throw stays a genuine scan error at error level.
// Also thrown by the BankTxConsumer forward path for a not-yet-priceable row (BUY_CRYPTO linked but not yet
// AML-priced; BUY_CRYPTO_RETURN not yet linked to its chargeback) and handled the same way by its forward-loop catch
// (verbose, cursor/watermark stays → head-of-line retry next run).
export class LedgerGateBlockedException extends Error {
  constructor(message: string) {
    super(message);
  }
}
