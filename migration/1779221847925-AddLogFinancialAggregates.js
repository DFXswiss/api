/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLogFinancialAggregates1779221847925 {
  name = 'AddLogFinancialAggregates1779221847925';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Denormalised aggregates for the FinancialDataLog cron rows, consumed by the dashboard chart
    // endpoint. Nullable so older rows continue to work via a JSON.parse fallback in the service.
    await queryRunner.query(`ALTER TABLE "log" ADD "totalBalanceChf" float`);
    await queryRunner.query(`ALTER TABLE "log" ADD "plusBalanceChf" float`);
    await queryRunner.query(`ALTER TABLE "log" ADD "minusBalanceChf" float`);
    await queryRunner.query(`ALTER TABLE "log" ADD "btcPriceChf" float`);
    await queryRunner.query(`ALTER TABLE "log" ADD "balancesByTypeJson" nvarchar(4000)`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "balancesByTypeJson"`);
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "btcPriceChf"`);
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "minusBalanceChf"`);
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "plusBalanceChf"`);
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "totalBalanceChf"`);
  }
};
