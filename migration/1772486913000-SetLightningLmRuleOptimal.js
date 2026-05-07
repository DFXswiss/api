/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Set optimal value for Lightning BTC liquidity management rule 133.
 *
 * Rule 133 had optimal = NULL, causing the system to always withdraw exactly
 * the deficit amount. This leads to micro-withdrawals that fall below exchange
 * minimums (e.g. Binance minimum of 0.00002 BTC), triggering repeated
 * pause/reactivate cycles without resolving the liquidity deficit.
 *
 * Setting optimal to 0.00001 adds a small buffer to prevent these cycles.
 *
 * See: https://github.com/DFXswiss/api/issues/3323
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SetLightningLmRuleOptimal1772486913000 {
  name = 'SetLightningLmRuleOptimal1772486913000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "optimal" = 0.00001
      WHERE "id" = 133
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "optimal" = NULL
      WHERE "id" = 133
    `);
  }
};
