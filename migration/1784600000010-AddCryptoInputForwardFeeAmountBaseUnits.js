/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287). Capture the EXACT integer wei of the on-chain GAS FEE of a deposit
 * FORWARD (crypto_input.forwardFeeAmount) — gasUsed * effectiveGasPrice straight from the forward tx receipt, read at
 * OUTPUT confirmation once the tx is mined — so the ledger books the seq1 network-fee leg wei-exact instead of the
 * estimate-derived <=8-dp float. This nullable `numeric` column holds that exact value; the float forwardFeeAmount (a
 * pre-broadcast fee ESTIMATE) and every existing behaviour are untouched.
 *
 * Scope: populated ONLY for an EVM COIN forward, where the native gas coin IS the forwarded (and seq1-booked) asset, so
 * the exact wei is verbatim-bookable at that leg's 18-dp scale. A token forward pays gas in the native coin — a
 * DIFFERENT asset than the seq1 leg's deposit token — so no exact integer exists at that leg's scale and the column
 * stays NULL (fail-open, derive from the float). Non-EVM chains and any capture error likewise keep it NULL.
 *
 * Purely additive + nullable, NO historical backfill: legacy rows read NULL and the ledger falls back to the float
 * derivation exactly as before, so this migration cannot change any existing booking. A backfill would only reproduce
 * the float the ledger already computes (no precision gained) and cannot recover a past receipt's exact gas cheaply, so
 * it is deliberately omitted; a row becomes exact only once a NEW forward confirmation writes its captured fee wei.
 *
 * Verified on: a throwaway Postgres 16 on the build host (column adds + drops cleanly, existing rows read NULL). Runs
 * at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCryptoInputForwardFeeAmountBaseUnits1784600000010 {
  name = 'AddCryptoInputForwardFeeAmountBaseUnits1784600000010';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "crypto_input" ADD "forwardFeeAmountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "forwardFeeAmountBaseUnits"`);
  }
};
