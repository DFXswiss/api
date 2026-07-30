/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add a composite index on `trading_order ("tradingRuleId", "id")` so the per-minute
 * "latest trading order per rule" lookup stops doing a full sequential scan of the table.
 * Row counts and sizes are given further down, together with where each was measured.
 *
 * The query this targets is:
 * `SELECT MAX("tradingOrder"."id") AS "tradingOrderId" FROM "trading_order" "tradingOrder"
 * INNER JOIN "trading_rule" "tradingRule" ON "tradingRule"."id" = "tradingOrder"."tradingRuleId"
 * GROUP BY "tradingOrder"."tradingRuleId"`.
 * Source: `TradingRuleService.getCurrentTradingOrders`, called from `LogJobService` once per
 * minute as part of the financial-log job.
 *
 * Production `EXPLAIN (ANALYZE, BUFFERS)` for this exact aggregate query (measured externally
 * against production; not reproducible from this repository) showed Execution Time 489 ms,
 * Buffers: shared hit=3734 read=85614 — only 4.2% of blocks came from the 1 GB `shared_buffers`
 * cache, the rest was freshly read from disk on every one-minute run. Table size at the time of
 * measurement in production: 698 MB. Result: 17 rows (there are exactly 17 `trading_rule` rows).
 *
 * Column order `("tradingRuleId", "id")` is intentional: equality on `tradingRuleId` first so
 * Postgres can jump straight to one rule's leaf range, then `id` so a backward index scan finds
 * the maximum id for that rule without a sort or a table-wide aggregate. The same physical order
 * is what enables the Index Only Scan plan change for the unchanged aggregate described below;
 * it would also be what a correlated per-rule lookup needs, if this repository's test
 * infrastructure allowed one (see the comment on the service method for that trade-off).
 *
 * This migration ships ONLY the index; the query above is not rewritten. Measured externally
 * against a Postgres 17.10 rebuild with production planner settings, loaded with 5,421,152 rows
 * (730 MB) and the 17 `trading_rule` rows in real production distribution (not reproducible
 * from this repository):
 * - Without this index: Parallel Seq Scan, 93,486 buffer blocks, 8,181 ms (warm).
 * - With this index: Parallel Index Only Scan, Heap Fetches: 0, 15,020 buffer blocks, 5,676 ms
 *   (warm).
 * The planner picks this index for exactly the query above with no code change — this migration
 * is therefore not a no-op. The index itself is 116 MB. That matches the fresh production
 * measurement above (489 ms, shared hit=3734 read=85614, only 4.2% cache hit rate, 698 MB
 * table): a 116 MB index has a realistic chance of staying resident in the 1 GB
 * `shared_buffers`; the substantially larger table demonstrably does not. A correlated per-rule
 * lookup (`SELECT r.id, (SELECT MAX(o.id) FROM trading_order o WHERE o."tradingRuleId" = r.id)
 * FROM trading_rule r;`) would be faster still with this index — Index Only Scan Backward, 52
 * buffer blocks, 1.5 ms (warm), measured on the same rebuild (same external measurement
 * disclaimer: not reproducible from this repository) — but is NOT shipped here: it would need a
 * correlated subquery that this repository's pg-mem-based test suite (pg-mem 3.0.14) cannot
 * execute. See the comment on `TradingRuleService.getCurrentTradingOrders` for that trade-off.
 *
 * The existing single-column index `IDX_f862025cb7ca5a2d66d14fb89a` on
 * `trading_order ("tradingRuleId")` is NOT removed by this migration. It was created by
 * `AddForeignKeyIndexes1779802432879` (`CREATE INDEX "IDX_f862025cb7ca5a2d66d14fb89a" ON
 * "trading_order" ("tradingRuleId")`). The new composite index makes that single-column index
 * functionally redundant for most purposes (any query that can use the single-column index on
 * `tradingRuleId` can equally use the new composite, since `tradingRuleId` is its leading
 * column), but dropping the old index is out of scope for this change and is left for a
 * separate, later migration.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see `src/config/config.ts`, `migrationsRun` gated by the `SQL_MIGRATE` env
 * var). CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the
 * migration.
 *
 * Lock behaviour, stated precisely: all pending migrations run inside a single database
 * transaction (TypeORM default `migrationsTransactionMode: "all"`), and PostgreSQL only
 * releases locks at COMMIT, not at the end of each statement. Evidence:
 * `node_modules/typeorm/data-source/DataSource.js` (`migrationExecutor.transaction =
 * options?.transaction || this.options?.migrationsTransactionMode || "all"` — default `"all"`);
 * `src/config/config.ts` only sets `migrationsRun` and never overrides
 * `migrationsTransactionMode` (corroborated by the comment in
 * `src/shared/models/asset/__tests__/add-binance-custody-assets-ondo-ada.migration.spec.ts` —
 * "no migrationsTransactionMode override → default 'all'");
 * `node_modules/typeorm/migration/MigrationExecutor.js` starts one transaction for pending
 * migrations and commits only at the end. A plain CREATE INDEX holds a SHARE lock for the
 * entire build; reads continue throughout, but writes to the table are blocked while that lock
 * is held. Because locks are held until COMMIT, if other migrations are pending in the same
 * batch, this index's SHARE lock is held until all of them commit together, not just until this
 * statement finishes. `SET LOCAL lock_timeout` bounds only how long we wait to ACQUIRE the lock,
 * not how long we hold it once acquired, and it is scoped to the whole transaction — that is
 * exactly why it is set only once at the top of `up()` and once at the top of `down()`, not per
 * statement (there is only one `CREATE INDEX` / one `DROP INDEX` in this migration).
 *
 * Risk framing: this migration runs boot-blockingly at app startup (`migrationsRun`, gated by
 * the `SQL_MIGRATE` env var), so the starting instance itself is not yet serving requests and is
 * not itself a writer. Concurrent writers would be a still-running predecessor instance during a
 * rolling deploy, or external consumers. If a lock conflict occurs, the migration aborts after
 * `lock_timeout` and so does the app start — that is fail-closed and intentional, but it is a
 * deploy abort and must be named as such.
 *
 * `down()` reverses this with `DROP INDEX` and is subject to a stricter lock: PostgreSQL takes
 * an ACCESS EXCLUSIVE lock for `DROP INDEX` (vs. the SHARE lock `CREATE INDEX` takes above), and
 * ACCESS EXCLUSIVE conflicts with every other lock mode, including the AccessShareLock a plain
 * `SELECT` takes — so `down()` blocks reads as well as writes, not writes alone. Because
 * `down()` also runs inside the single-batch transaction (same TypeORM default
 * `migrationsTransactionMode: "all"`), the same hold-until-COMMIT reasoning applies.
 *
 * Honest disclaimer: whether the Postgres planner will actually pick this new index for the
 * unchanged aggregate query above has NOT been verified in production itself, because the index
 * does not exist there yet. The rebuild measurement above already shows that the plan changes
 * from Parallel Seq Scan to Parallel Index Only Scan when this index exists — but that is still
 * not confirmation on production itself. As a point of reference (not a guarantee), the same
 * style of prediction was made for the `created` index in
 * `AddTradingOrderCreatedIndex1785470000000` (selectivity + cost-model reasoning only, no prior
 * plan-change observation) and was confirmed after that deploy (measured externally against
 * production; not reproducible from this repository): the query's plan changed from a Seq Scan
 * to an Index Scan, execution time dropped from 141.283 ms to 30.3 ms, and buffer reads dropped
 * from 89,282 to 2,716.
 *
 * Index name: `IDX_710fd49e19d248643cb2afa70f` on `trading_order ("tradingRuleId", "id")`.
 * This is not an arbitrary name but the deterministic name TypeORM's DefaultNamingStrategy would
 * generate itself, since custom index naming is disallowed by CONTRIBUTING.md. The name is
 * `IDX_` followed by the first 26 hex characters of `sha1('trading_order_id_tradingRuleId')`
 * (table name + `_` + the two column names `id` and `tradingRuleId` sorted alphabetically and
 * joined with `_`, per TypeORM's DefaultNamingStrategy — `id` sorts before `tradingRuleId`).
 * The physical index column order remains `("tradingRuleId", "id")` as required for the equality
 * + max-id access path above; only the name derivation sorts the column names.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddTradingOrderRuleIdIndex1785510000000 {
  name = 'AddTradingOrderRuleIdIndex1785510000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire the lock, not how
    // long the lock is held. Set once: this migration has a single CREATE INDEX statement.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_710fd49e19d248643cb2afa70f" ON "trading_order" ("tradingRuleId", "id")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire the lock, not how
    // long the lock is held. Set once: this migration has a single DROP INDEX statement.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_710fd49e19d248643cb2afa70f"`);
  }
};
