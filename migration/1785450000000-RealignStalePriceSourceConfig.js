/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Remove the cross-check from two price rules whose comparison market no longer trades.
 *
 * A rule only persists a refreshed price once its deviation check clears. Where the configured
 * comparison market has stopped trading it still answers with its last price, frozen at the
 * moment it halted, so the gap against the live primary source widens indefinitely and the check
 * can never clear. The rule is then never written back and its price ages out for every consumer.
 *
 * The checks are removed rather than widened: the gap is not a tolerance that needs stretching,
 * and no limit wide enough to cover a frozen quote would still reject a wrong one. Rules without
 * a cross-check are an established configuration here. A third rule shows the same symptom but
 * its comparison market is still trading and the deviation it reports is genuine, so that check
 * is deliberately left in place.
 *
 * Both directions are guarded on the exact state they expect, so `up` no-ops where the
 * configuration already differs and `down` only reverses rows that `up` actually changed.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RealignStalePriceSourceConfig1785450000000 {
  name = 'RealignStalePriceSourceConfig1785450000000';

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
        AND "check1Limit" = 0.03
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
        AND "check1Limit" = 0.03
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query(`
      UPDATE "price_rule"
      SET "check1Source" = 'Kucoin',
          "check1Asset" = 'ISLM',
          "check1Reference" = 'USDT',
          "check1Limit" = 0.03
      WHERE "id" = 42
        AND "check1Source" IS NULL
        AND "check1Asset" IS NULL
        AND "check1Reference" IS NULL
        AND "check1Limit" IS NULL
    `);

    await queryRunner.query(`
      UPDATE "price_rule"
      SET "check1Source" = 'Binance',
          "check1Asset" = 'MKR',
          "check1Reference" = 'USDT',
          "check1Limit" = 0.03
      WHERE "id" = 17
        AND "check1Source" IS NULL
        AND "check1Asset" IS NULL
        AND "check1Reference" IS NULL
        AND "check1Limit" IS NULL
    `);
  }
};
