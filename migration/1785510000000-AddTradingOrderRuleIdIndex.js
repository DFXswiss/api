/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add a composite index on `trading_order ("tradingRuleId", "id")` so the per-minute
 * "latest trading order per rule" lookup stops doing a full sequential scan on this
 * 5.4-million-row / ~920 MB table.
 *
 * The query this targets is:
 * `SELECT MAX("tradingOrder"."id") AS "tradingOrderId" FROM "trading_order" "tradingOrder"
 * INNER JOIN "trading_rule" "tradingRule" ON "tradingRule"."id" = "tradingOrder"."tradingRuleId"
 * GROUP BY "tradingOrder"."tradingRuleId"`.
 * Source: `TradingRuleService.getCurrentTradingOrders`, called from `LogJobService` once per
 * minute as part of the financial-log job.
 *
 * Production `EXPLAIN (ANALYZE, BUFFERS)` for this exact aggregate query showed a Parallel Seq
 * Scan on `trading_order`, rows=1,806,836 per worker process ×3 = 5,420,508 rows scanned,
 * Buffers: shared hit=2394 read=86958 (~680 MB from disk), Execution Time 474.567 ms, Result:
 * 17 rows (there are exactly 17 `trading_rule` rows). That is 5.4 million rows read to compute
 * 17 maxima.
 *
 * Column order `("tradingRuleId", "id")` is intentional: equality on `tradingRuleId` first so
 * Postgres can jump straight to one rule's leaf range, then `id` so a backward index scan finds
 * the maximum id for that rule without a sort or a table-wide aggregate. The same physical order
 * is what the rewritten `getCurrentTradingOrders` (per-rule `MAX(id)` lookups) needs.
 *
 * Why the index and the query rewrite MUST ship together — measured, not theoretical. The
 * "obvious" rewrite alone (a correlated subquery per rule against the CURRENT index set, without
 * this composite index) was measured in production and is dramatically worse than the status
 * quo:
 * `SELECT r.id, (SELECT MAX(o.id) FROM trading_order o WHERE o."tradingRuleId" = r.id) FROM
 * trading_rule r;`
 * Plan: Index Scan Backward using the primary key on `id` (loops=17), Buffers: shared
 * hit=724515 read=109090, Execution Time 4,329.406 ms — about 9× slower than the current
 * 474.567 ms aggregate. Without an index on `("tradingRuleId", "id")`, Postgres walks the
 * primary key (`id` only) backward once per rule and discards every row that belongs to a
 * different rule while searching; it has no way to jump straight to a given rule's row range.
 * The existing single-column index `IDX_f862025cb7ca5a2d66d14fb89a` on
 * `trading_order ("tradingRuleId")` does not help either: without `id` in the index, Postgres
 * still cannot read the max `id` per group directly from it. PostgreSQL 17.10 (the version in
 * production here) has no index skip scan — that lands in PostgreSQL 18, not before. This is why
 * the rewrite of `TradingRuleService.getCurrentTradingOrders` is only safe to deploy together
 * with this composite index in the same change, never as two separate deploys: the rewrite alone
 * would be ~9× slower than today (474.567 ms vs. 4,329.406 ms).
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
 * rewritten per-rule `MAX(id)` lookups has NOT been verified in production, because the index
 * does not exist there yet. As a point of reference (not a guarantee), the same style of
 * prediction was made for the `created` index in `AddTradingOrderCreatedIndex1785470000000`
 * (selectivity + cost-model reasoning only, no prior plan-change observation) and was confirmed
 * after that deploy: the query's plan changed from a Seq Scan to an Index Scan, execution time
 * dropped from 141.283 ms to 30.3 ms, and buffer reads dropped from 89,282 to 2,716.
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
