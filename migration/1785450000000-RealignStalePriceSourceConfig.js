/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Remove the cross-check from two price rules whose comparison market no longer trades.
 *
 * A rule only persists a refreshed price once its deviation check clears, so a check that can
 * never clear stops the rule from being written back at all and its price ages out for every
 * consumer. Both rules are in that state, by two different routes:
 *
 * - One comparison market is halted but still answering. It returns the last price it traded at,
 *   frozen at the moment it stopped, so the gap against the live primary source widens
 *   indefinitely and the deviation check never clears.
 * - The other pair has been delisted outright. Looking it up raises, the surrounding lookup
 *   rejects, and the rule cannot be resolved at all.
 *
 * The checks are removed rather than widened: the gap is not a tolerance that needs stretching,
 * and no limit wide enough to cover a frozen quote would still reject a wrong one. Rules without
 * a cross-check are an established configuration here. A third rule shows a similar symptom but
 * its comparison market is still trading and the deviation it reports is genuine, so that check
 * is deliberately left in place.
 *
 * Both directions match on the exact state they expect, so `up` no-ops wherever the configuration
 * already differs — including freshly seeded environments, where these rules carry a different
 * shape — and `down` only writes rows that are in exactly the state `up` leaves behind.
 *
 * `up` then checks for rules that still carry a cross-check and reports them. Reaching that end
 * state without changing anything is a legitimate outcome and stays silent; a rule still carrying
 * one means the stored configuration has drifted away from what this migration targets, which
 * would otherwise be recorded as applied with no signal.
 *
 * `down` carries no such check. The only end-state predicate that separates a row it failed to
 * restore from a freshly seeded one — every check column still NULL — is exactly the predicate its
 * own statements consume, so a check on it could never fire. Broadening it to `check1Source` alone,
 * the way `up`'s check is broadened past its guard, would instead flag freshly seeded rows, which
 * legitimately have nothing to revert.
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
          "check1Limit" = NULL,
          "updated" = NOW()
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
          "check1Limit" = NULL,
          "updated" = NOW()
      WHERE "id" = 42
        AND "check1Source" = 'Kucoin'
        AND "check1Asset" = 'ISLM'
        AND "check1Reference" = 'USDT'
        AND "check1Limit" = 0.03
    `);

    await queryRunner.query(`
      DO $$
      DECLARE remaining integer;
      BEGIN
        SELECT count(*) INTO remaining
        FROM "price_rule"
        WHERE "id" IN (17, 42) AND "check1Source" IS NOT NULL;
        IF remaining > 0 THEN
          RAISE NOTICE 'RealignStalePriceSourceConfig: % of 2 rules still carry a cross-check; stored configuration differs from the state this migration targets', remaining;
        END IF;
      END $$
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
          "check1Limit" = 0.03,
          "updated" = NOW()
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
          "check1Limit" = 0.03,
          "updated" = NOW()
      WHERE "id" = 17
        AND "check1Source" IS NULL
        AND "check1Asset" IS NULL
        AND "check1Reference" IS NULL
        AND "check1Limit" IS NULL
    `);
  }
};
