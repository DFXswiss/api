/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Realign two pieces of pricing configuration that can no longer be satisfied.
 *
 * A deviation check can only pass while its comparison market still quotes. Once that market
 * stops quoting, the check never clears, the rule is never written back, and the price ages out
 * for every consumer. Where that has happened the check is removed rather than widened, so the
 * remaining source is used as-is instead of a tolerance being stretched to cover a gap.
 *
 * Separately, an entry that is neither buyable nor sellable is taken out of the recurring payment
 * pricing set; there is nothing for a price on it to serve.
 *
 * Every statement is conditional on the state this migration was written against, so it is
 * idempotent and becomes a no-op wherever the configuration already differs.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RealignStalePriceSourceConfig1785341400000 {
  name = 'RealignStalePriceSourceConfig1785341400000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`
      UPDATE "price_rule"
      SET "check1Source" = NULL,
          "check1Asset" = NULL,
          "check1Reference" = NULL,
          "check1Limit" = NULL
      WHERE "id" = 17
        AND "check1Source" = 'Binance'
        AND "check1Asset" = 'MKR'
        AND "check1Reference" = 'USDT'
    `);

    await queryRunner.query(`
      UPDATE "price_rule"
      SET "check1Source" = NULL,
          "check1Asset" = NULL,
          "check1Reference" = NULL,
          "check1Limit" = NULL
      WHERE "id" = 42
        AND "check1Source" = 'Kucoin'
        AND "check1Asset" = 'ISLM'
        AND "check1Reference" = 'USDT'
    `);

    await queryRunner.query(`
      UPDATE "asset"
      SET "paymentEnabled" = false
      WHERE "id" = 261
        AND "paymentEnabled" = true
        AND "buyable" = false
        AND "sellable" = false
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`
      UPDATE "asset"
      SET "paymentEnabled" = true
      WHERE "id" = 261
        AND "paymentEnabled" = false
    `);

    await queryRunner.query(`
      UPDATE "price_rule"
      SET "check1Source" = 'Kucoin',
          "check1Asset" = 'ISLM',
          "check1Reference" = 'USDT',
          "check1Limit" = 0.03
      WHERE "id" = 42
        AND "check1Source" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "price_rule"
      SET "check1Source" = 'Binance',
          "check1Asset" = 'MKR',
          "check1Reference" = 'USDT',
          "check1Limit" = 0.03
      WHERE "id" = 17
        AND "check1Source" IS NULL
    `);
  }
};
