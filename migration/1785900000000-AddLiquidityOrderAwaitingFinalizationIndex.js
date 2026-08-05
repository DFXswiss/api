/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Indexes the standing-order read in `DexService.finalizePurchaseOrders`, which runs every 30
 * seconds and selects `isReady = false AND txId IS NOT NULL`.
 *
 * No existing index covers those two columns. `IDX_liquidity_order_inflight_purchase` does not
 * apply: its predicate is `isComplete = false AND type = 'Purchase'`, and neither column appears in
 * this query, so PostgreSQL cannot prove the index predicate holds for the rows it needs. The read
 * therefore falls back to a sequential scan over the whole table, which grows without bound while
 * the set it is looking for does not — a purchase order is standing only between its transaction
 * being sent and its result being recorded (DFXServer/server#1223 measured `LiquidityOrder`
 * statements at 61.2 s total in one hour, peaking at 4535 ms).
 *
 * Index name: `IDX_35b02b963661233664a9821d03` on `liquidity_order ("id") WHERE "isReady" = false
 * AND "txId" IS NOT NULL`. Not an arbitrary name but the deterministic one TypeORM's
 * DefaultNamingStrategy generates for the `@Index` declared on the entity, since custom index
 * naming is disallowed by CONTRIBUTING.md: `IDX_` followed by the first 26 hex characters of
 * `sha1('liquidity_order_id_"isReady" = false AND "txId" IS NOT NULL')` — table name, column names,
 * then the index filter condition, per `DefaultNamingStrategy.indexName`. The predicate string must
 * stay byte-identical to the entity's `where` option, or the two names diverge and schema
 * generation would see a missing index next to an unknown one.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLiquidityOrderAwaitingFinalizationIndex1785900000000 {
  name = 'AddLiquidityOrderAwaitingFinalizationIndex1785900000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire the lock, not how
    // long the lock is held. Set once: this migration has a single CREATE INDEX statement.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_35b02b963661233664a9821d03" ON "liquidity_order" ("id") WHERE "isReady" = false AND "txId" IS NOT NULL`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_35b02b963661233664a9821d03"`);
  }
};
