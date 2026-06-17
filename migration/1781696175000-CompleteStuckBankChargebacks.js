// Bank-based BuyCrypto chargebacks (AML-failed, fiat already refunded) were left
// with isComplete=false / status='Created' because the old chargebackFillUp() relied
// on a fragile remittance-info re-match that never linked the outgoing bankTx. As a
// result they kept counting as a pending minus-liability in the FinancialDataLog,
// permanently depressing totalBalanceChf by the refunded amount.
//
// The code fix (chargebackFillUp now completing from chargebackOutput) only takes
// effect for runs after deployment; this migration retroactively completes the
// orders that are already stuck. It uses the exact same condition as the code fix:
// an executed chargebackOutput (FiatOutput isComplete=true with a bankTx) but an
// order still flagged incomplete.
//
// Scope (verified via /gs/debug): 4 orders, 26'900 CHF (CHF input).
// chargebackBankTx is taken from the order's chargebackOutput.bankTx — the same
// deterministic source the code fix uses.
//
// down() is intentionally a no-op: the completion reflects the real settled state
// (the refund left the account), so reverting it would re-introduce the accounting
// error. The COUNT pre-check makes up() a no-op on dev/staging where no rows match.
module.exports = class CompleteStuckBankChargebacks1781696175000 {
  name = 'CompleteStuckBankChargebacks1781696175000';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count
      FROM   buy_crypto bc
      JOIN   fiat_output fo ON fo.id = bc."chargebackOutputId"
      WHERE  fo."isComplete" = true
        AND  fo."bankTxId" IS NOT NULL
        AND  bc."chargebackBankTxId" IS NULL
        AND  bc."amlCheck" = 'Fail'
        AND  bc."isComplete" = false
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE buy_crypto AS bc
      SET    "isComplete" = true,
             status = 'Complete',
             "chargebackBankTxId" = fo."bankTxId"
      FROM   fiat_output AS fo
      WHERE  bc."chargebackOutputId" = fo.id
        AND  fo."isComplete" = true
        AND  fo."bankTxId" IS NOT NULL
        AND  bc."chargebackBankTxId" IS NULL
        AND  bc."amlCheck" = 'Fail'
        AND  bc."isComplete" = false
    `);
  }

  async down() {
    // no-op: completion reflects the real settled state; reverting would re-introduce
    // the accounting error.
  }
};
