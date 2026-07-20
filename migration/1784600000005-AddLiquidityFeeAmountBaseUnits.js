/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 3). Capture the EXACT integer wei of the on-chain GAS FEE of a DfxDex
 * swap (liquidity_order.feeAmount) — gasUsed * effectiveGasPrice (+ L1 data fee on the L2s) straight from the tx
 * receipt — so the ledger books the swap's network-fee leg wei-exact instead of the <=8-dp float derivation (the 18-dp
 * native coin the gas is paid in loses precision otherwise). This nullable `numeric` column holds that exact value.
 *
 * Purely additive + nullable, NO historical backfill: the float feeAmount and every existing behaviour are untouched.
 * Legacy rows, non-EVM chains and any capture error keep the column NULL and the ledger falls back to the <=8-dp float
 * derivation exactly as before (fail-open) — so this migration cannot change any existing booking. A backfill would
 * only reproduce the float-derived value the ledger already computes (no precision gained), so it is deliberately
 * omitted; a row becomes exact only once a NEW swap writes its captured fee wei.
 *
 * Verified on: a throwaway Postgres 16 on the build host (column adds + drops cleanly, existing rows read NULL). Runs
 * at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLiquidityFeeAmountBaseUnits1784600000005 {
  name = 'AddLiquidityFeeAmountBaseUnits1784600000005';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "feeAmountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "feeAmountBaseUnits"`);
  }
};
