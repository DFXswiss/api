/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add a single-column index on `trading_order ("created")` so the per-minute financial-log
 * yield query stops doing a full sequential scan on this 5.4-million-row / 922 MB table.
 *
 * The query is:
 * `SELECT SUM("tradingOrder"."profitChf") AS "profit", SUM("tradingOrder"."txFeeAmountChf") AS "fee"
 * FROM "trading_order" "tradingOrder" WHERE "tradingOrder"."created" >= $1`.
 * Source: `TradingOrderService.getTradingOrderYield`
 * (`src/subdomains/core/trading/services/trading-order.service.ts:51-60`), called from
 * `LogJobService` (`src/subdomains/supporting/log/log-job.service.ts:1154`) with
 * `firstDayOfMonth` — i.e. once per minute, because that is where the `LogJobService` writes the
 * financial log.
 *
 * Production `EXPLAIN (ANALYZE, BUFFERS)` for the actual query predicate — `created >= '2026-07-01
 * 00:00:00'` (`Util.firstDayOfMonth()` always returns the first day of the month, see
 * `src/shared/utils/util.ts:410-412`) — showed a Parallel Seq Scan on `trading_order`
 * (`max_parallel_workers_per_gather` is 2 on this instance, so `loops=3` means the leader process
 * plus two workers — three participants total, not three workers), Rows Removed by Filter
 * 1,765,454 (×3 loops), rows=41,306 (×3 loops) = 123,918 matching rows (2.3% of the table), Buffers
 * shared hit=49 read=89282, Execution Time 141.283 ms. This is practically the same cost profile as
 * the scan the sibling migration (`AddLedgerContentChangeScanIndexes`) already fixed for a different
 * query — just from a different source, found via high-frequency `pg_stat_activity` sampling after
 * the sibling migration's indexes were already live in production and being used (confirmed via
 * `pg_stat_user_indexes`), yet the seq-scan load on `trading_order` had not gone down (45s-window
 * delta: 15 scans, 27.1M rows, 3,486 MB). The cost of this scan is practically independent of the
 * date filter, because a Seq Scan reads the whole table regardless of how selective the predicate
 * is: a separate measurement with `created >= '2026-07-30 00:00:00'` (only 454 matching rows) still
 * cost Execution Time 146.399 ms and Buffers read=88994 — almost identical to the 141.283 ms /
 * read=89282 above. What matters for the index decision is the query's selectivity (2.3% of the
 * table matches `created >= firstDayOfMonth`), not the runtime of any one scan. Stated honestly:
 * that the Postgres planner will actually pick this new index for this query is NOT verified in
 * production, because the index does not yet exist there — the decision to add it rests on the
 * measured selectivity (2.3%) and the correlation of `created` to physical row order (0.796,
 * discussed below), not on an observed plan change.
 *
 * Why a single-column index and not a covering index: the monthly window matched 123,918 of
 * 5.4 million rows (2.3%) at measurement time — a snapshot, since the table grows by roughly
 * 4,350 rows/day; the stable figure the decision rests on is the ~2.3% selectivity, not the
 * absolute row count. That ~2.3% selectivity is the basis for expecting an index scan to beat a
 * sequential scan here — not a verified planner outcome. The correlation of `created` to physical
 * row order is 0.796 per `pg_stats`, so heap accesses via the index are largely sequential. An
 * `INCLUDE (profitChf, txFeeAmountChf)` would bloat the index from an estimated ~103 MB to ~190 MB,
 * and would additionally depend on an up-to-date visibility map for index-only scans to pay off —
 * which is not reliably available here (`last_autovacuum` is NULL on this table). That trade-off is
 * the reason to omit `INCLUDE`.
 *
 * Why only `trading_order` and not the other tables queried in the same `LogJobService` block:
 * `crypto_input` is queried with `created >= firstDayOfMonth` on its own column (via
 * `PayInService.getPayInFee`) and has no index containing `created`. `buy_fiat` and `buy_crypto` are
 * different: they filter via `transaction: { created: MoreThan(from) }` in
 * `BuyFiatService.getBuyFiat` / `BuyCryptoService.getBuyCrypto` — i.e. on the joined `transaction`
 * table's `created` column with `>`, not their own `created` column — so an index on `buy_fiat`'s or
 * `buy_crypto`'s own `created` column would not serve this query path at all. `bank_tx` does have
 * one — `IDX_bank_tx_type_created` on `("type", "created")`, added by
 * `1784117860216-AddBankTxTypeCreatedIndex.js` for `BankTxService.getBankTxFee`, the same function
 * `LogJobService` calls in the same minute — but it only serves one of `getBankTxFee`'s three
 * sub-queries (the `type = ... AND created >= ...` one); with `type` leading, it can't serve the
 * legacy sum (`created` only, no `type` predicate) or the inline-charges query (`type IS NULL OR
 * type != ...`). All four tables are excluded here regardless, because they are orders of magnitude
 * smaller (`crypto_input` 234 MB, `bank_tx` 147 MB, `buy_crypto` 100 MB, `buy_fiat` 35 MB, versus
 * `trading_order` at 922 MB / 5.4 million rows), and no production measurement exists to justify an
 * index for them. This is a deliberate, considered exclusion, not an oversight.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see src/config/config.ts, migrationsRun gated by the SQL_MIGRATE env var).
 * CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the migration.
 *
 * Lock behaviour, stated precisely: all pending migrations run inside a single database
 * transaction (TypeORM default `migrationsTransactionMode: "all"`), and PostgreSQL only releases
 * locks at COMMIT, not at the end of each statement. Evidence:
 * `node_modules/typeorm/data-source/DataSource.js:263-265` (`migrationExecutor.transaction =
 * options?.transaction || this.options?.migrationsTransactionMode || "all"` — default `"all"`);
 * `src/config/config.ts:265` only sets `migrationsRun` and never overrides
 * `migrationsTransactionMode` (corroborated by the comment in
 * `src/shared/models/asset/__tests__/add-binance-custody-assets-ondo-ada.migration.spec.ts:348` —
 * "no migrationsTransactionMode override → default 'all'");
 * `node_modules/typeorm/migration/MigrationExecutor.js:206` starts one transaction for pending
 * migrations and commits only at the end. A plain CREATE INDEX holds a SHARE lock for the entire
 * build; reads continue throughout, but writes to the table are blocked while that lock is held.
 * Because locks are held until COMMIT, if other migrations are pending in the same batch, this
 * index's SHARE lock is held until all of them commit together, not just until this statement
 * finishes. `SET LOCAL lock_timeout` bounds only how long we wait to ACQUIRE the lock, not how
 * long we hold it once acquired, and it is scoped to the whole transaction — that is exactly why
 * it is set only once at the top of `up()` and once at the top of `down()`, not per statement
 * (there is only one `CREATE INDEX` / one `DROP INDEX` in this migration).
 *
 * Production reference data point only: the nine `(updated, id)` indexes in the sibling migration
 * (`AddLedgerContentChangeScanIndexes`) built in under 40 seconds combined in production, with
 * zero lock-wait. That figure is a reference data point, NOT a measured or asserted upper bound
 * for this index's build time, and must NOT be treated as a hard ceiling.
 *
 * Risk framing: this migration runs boot-blockingly at app startup (`migrationsRun`, gated by the
 * `SQL_MIGRATE` env var), so the starting instance itself is not yet serving requests and is not
 * itself a writer. Concurrent writers would be a still-running predecessor instance during a
 * rolling deploy, or external consumers. If a lock conflict occurs, the migration aborts after
 * `lock_timeout` and so does the app start — that is fail-closed and intentional, but it is a
 * deploy abort and must be named as such.
 *
 * `down()` reverses this with `DROP INDEX` and is subject to a stricter lock: PostgreSQL takes an
 * ACCESS EXCLUSIVE lock for `DROP INDEX` (vs. the SHARE lock `CREATE INDEX` takes above), and
 * ACCESS EXCLUSIVE conflicts with every other lock mode, including the AccessShareLock a plain
 * `SELECT` takes — so `down()` blocks reads as well as writes, not writes alone. Because `down()`
 * also runs inside the single-batch transaction (same TypeORM default
 * `migrationsTransactionMode: "all"`), the same hold-until-COMMIT reasoning applies.
 *
 * Index name: `IDX_280bd108621ace81e32f26d224` on `trading_order ("created")`.
 * This is not an arbitrary name but the deterministic name TypeORM's DefaultNamingStrategy would
 * generate itself, since custom index naming is disallowed by CONTRIBUTING.md. The name is
 * `IDX_` followed by the first 26 hex characters of `sha1('trading_order_created')` (table name +
 * `_` + column name, per TypeORM's DefaultNamingStrategy).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddTradingOrderCreatedIndex1785470000000 {
  name = 'AddTradingOrderCreatedIndex1785470000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire the lock, not how
    // long the lock is held. Set once: this migration has a single CREATE INDEX statement.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_280bd108621ace81e32f26d224" ON "trading_order" ("created")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire the lock, not how
    // long the lock is held. Set once: this migration has a single DROP INDEX statement.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_280bd108621ace81e32f26d224"`);
  }
};
