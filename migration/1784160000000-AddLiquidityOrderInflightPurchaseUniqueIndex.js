/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Prevents a second in-flight purchase from being created for the same (context, correlationId)
 * before the first purchase has a definitive outcome. Completed and cancelled purchase rows are
 * intentionally excluded, as are reservations that may legitimately share the correlation ID.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLiquidityOrderInflightPurchaseUniqueIndex1784160000000 {
  name = 'AddLiquidityOrderInflightPurchaseUniqueIndex1784160000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_liquidity_order_inflight_purchase" ON "liquidity_order" ("context", "correlationId") WHERE "isComplete" = false AND "type" = 'Purchase'`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_liquidity_order_inflight_purchase"`);
  }
};
