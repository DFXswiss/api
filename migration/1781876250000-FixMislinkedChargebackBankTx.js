// One-off reconciliation correction for buy_crypto 124581.
//
// Cause: while #3896 had loosened getBankTxByRemittanceInfo to a `LIKE '%ref%'`
// substring match (reverted in #3928), the chargeback completion resolved the
// outgoing bank_tx by remittance and, via the trailing `ORDER BY id DESC`,
// returned the NEWEST matching row instead of the entity's own payout:
//   - 202384  the chargeback's own outgoing payout (bounced, then repeated)
//   - 203191  the re-send produced by bank_tx_repeat 195 (sourceBankTx = 202384);
//             same amount, same reference head, but the bank appended customer
//             text and truncated at the 140-char SEPA limit, so it only matched
//             as a substring and was newer by id.
// Result: buy_crypto 124581.chargebackBankTx was set to the foreign repeat payout
// 203191 (it should equal chargebackOutput.bankTx = 202384, the invariant #3906
// completion enforces), and bank_tx 203191 kept type 'BuyCryptoReturn' instead of
// the repeat-output type 'BankTxRepeat-Chargeback' (the only such mistyped repeat
// output of 38).
//
// No financial impact: the cash flow nets to zero (in 201836, out 202384, the
// bounce back in 202543, out 203191) — the customer was refunded exactly once.
// This corrects metadata/reconciliation links only.
//
// Env-guarded: each step is gated by a pre-check on the exact corrupted state, so
// up() is a no-op anywhere the affected rows are absent or already corrected
// (dev/staging), and is safe to re-run. down() restores the prior state and is
// likewise gated on the corrected state.
module.exports = class FixMislinkedChargebackBankTx1781876250000 {
  name = 'FixMislinkedChargebackBankTx1781876250000';

  async up(queryRunner) {
    const [{ count: linkCount }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM buy_crypto
      WHERE id = 124581 AND "chargebackBankTxId" = 203191
    `);
    if (parseInt(linkCount) > 0) {
      await queryRunner.query(`
        UPDATE buy_crypto SET "chargebackBankTxId" = 202384
        WHERE id = 124581 AND "chargebackBankTxId" = 203191
      `);
    }

    const [{ count: typeCount }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM bank_tx
      WHERE id = 203191 AND type = 'BuyCryptoReturn'
    `);
    if (parseInt(typeCount) > 0) {
      await queryRunner.query(`
        UPDATE bank_tx SET type = 'BankTxRepeat-Chargeback'
        WHERE id = 203191 AND type = 'BuyCryptoReturn'
      `);
    }
  }

  async down(queryRunner) {
    const [{ count: linkCount }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM buy_crypto
      WHERE id = 124581 AND "chargebackBankTxId" = 202384
    `);
    if (parseInt(linkCount) > 0) {
      await queryRunner.query(`
        UPDATE buy_crypto SET "chargebackBankTxId" = 203191
        WHERE id = 124581 AND "chargebackBankTxId" = 202384
      `);
    }

    const [{ count: typeCount }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM bank_tx
      WHERE id = 203191 AND type = 'BankTxRepeat-Chargeback'
    `);
    if (parseInt(typeCount) > 0) {
      await queryRunner.query(`
        UPDATE bank_tx SET type = 'BuyCryptoReturn'
        WHERE id = 203191 AND type = 'BankTxRepeat-Chargeback'
      `);
    }
  }
};
