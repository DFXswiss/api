/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 1). Capture the on-chain DEPOSIT (crypto_input) and WITHDRAWAL
 * (payout_order) amounts as EXACT integer base units (wei/satoshi) at the source — the raw on-chain integer is kept
 * at ingestion, BEFORE the lossy float collapse in the existing `amount` column, and booked verbatim into the ledger
 * (matching ledger_leg.amountBaseUnits from #4280). These two nullable `numeric` columns hold that exact value.
 *
 * Purely additive + nullable, NO historical backfill: the float `amount` and every existing behaviour are untouched.
 * Legacy rows (and chains without a raw on-chain integer) keep amountBaseUnits NULL and the ledger falls back to the
 * <=8-dp float derivation exactly as before (fail-open) — so this migration cannot change any existing booking. A
 * backfill would only reproduce the float-derived value the ledger already computes (no precision gained), so it is
 * deliberately omitted; a row becomes exact only once a NEW ingestion writes its captured base units.
 *
 * Verified on: a throwaway Postgres 16 on the build host (columns add + drop cleanly, existing rows read NULL). Runs at
 * boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddOnChainAmountBaseUnits1784600000002 {
  name = 'AddOnChainAmountBaseUnits1784600000002';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "crypto_input" ADD "amountBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "payout_order" ADD "amountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "payout_order" DROP COLUMN "amountBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "amountBaseUnits"`);
  }
};
