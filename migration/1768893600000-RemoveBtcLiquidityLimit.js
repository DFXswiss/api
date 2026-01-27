/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Remove accidentally set BTC liquidity limit.
 *
 * On 2026-01-19 at 16:09 UTC, the limit field on the BTC liquidity_management_rule
 * was accidentally set to 0.8863205, causing BuyFiat transactions over ~0.78 BTC
 * to fail with LIQUIDITY_LIMIT_EXCEEDED (e.g., transaction 296735).
 *
 * This migration sets the limit back to NULL (no limit) for BTC.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RemoveBtcLiquidityLimit1768893600000 {
  name = 'RemoveBtcLiquidityLimit1768893600000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "limit" = NULL
      WHERE "id" = 79 AND "context" = 'Bitcoin'
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "limit" = 0.8863205
      WHERE "id" = 79 AND "context" = 'Bitcoin'
    `);
  }
};
