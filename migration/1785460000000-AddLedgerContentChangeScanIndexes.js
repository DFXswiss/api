/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add composite indexes `(updated, id)` on the nine ledger consumer source tables so the
 * per-minute content-change-scan (`runContentChangeScan` in
 * `src/subdomains/core/accounting/services/consumers/ledger-watermark.helper.ts:210`) stops doing a
 * full sequential scan on each of them.
 *
 * The scan does:
 * `WHERE (updated > :scan OR (updated = :scan AND id > :scanId)) ORDER BY updated ASC, id ASC LIMIT 100`.
 * None of the nine tables previously had an index on `updated`.
 *
 * Column order `(updated, id)` is intentional: the query orders by `updated, id`, so an index on
 * `updated` alone would still need an explicit Sort step whenever several rows share the same
 * `updated` value — same reasoning as AddFinancialLogQueryIndex1785400000000 for `(created, id)`.
 *
 * Measured evidence: production `EXPLAIN (ANALYZE, BUFFERS)` for `trading_order` (921 MB, the
 * largest of the nine) without this index showed a Parallel Seq Scan, Rows Removed by Filter
 * 1,806,023 (x3 workers = 5,418,069 rows), Buffers shared hit=26096 read=63188 (~494 MB from disk
 * per call), returning only 4 matching rows, Execution Time 151.765 ms. A 45 s delta measurement
 * showed 4,750 MB of disk reads and 32.5 million rows read for `trading_order` alone.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see src/config/config.ts, migrationsRun gated by the SQL_MIGRATE env var).
 * CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the migration.
 *
 * Lock behaviour, stated precisely: all nine `CREATE INDEX` statements run inside a single
 * database transaction (TypeORM default `migrationsTransactionMode: "all"`), and PostgreSQL only
 * releases locks at COMMIT, not at the end of each statement. Evidence:
 * `node_modules/typeorm/data-source/DataSource.js:263-265` (`migrationExecutor.transaction =
 * options?.transaction || this.options?.migrationsTransactionMode || "all"` — default `"all"`);
 * `src/config/config.ts:265` only sets `migrationsRun` and never overrides
 * `migrationsTransactionMode` (corroborated by the comment in
 * `src/shared/models/asset/__tests__/add-binance-custody-assets-ondo-ada.migration.spec.ts:348` —
 * "no migrationsTransactionMode override → default 'all'");
 * `node_modules/typeorm/migration/MigrationExecutor.js:206` starts one transaction for pending
 * migrations and commits only at the end. A plain CREATE INDEX holds a SHARE lock for the entire
 * build; reads continue throughout, but writes to the table are blocked while that lock is held.
 * Because locks are held until COMMIT, the write-blocking window for `trading_order` (the first
 * table built) is the sum of all nine index builds, not just its own, and by the time the
 * transaction commits all nine tables — including central transaction tables `bank_tx`,
 * `buy_crypto`, `crypto_input`, `payout_order` — are simultaneously write-blocked. If further
 * migrations are pending at the same time, those run in the same transaction too and extend the
 * window further. Splitting this into multiple separate migration files would NOT change this
 * (the same transaction still applies across files run in the same batch). `SET LOCAL
 * lock_timeout` caps only how long we WAIT to acquire a lock, not how long we hold it once
 * acquired. Production scan+sort for the biggest table's `(updated, id)` was measured at 1159 ms
 * — but that number is a `work_mem`-bound External Merge sort spilling ~116 MB to disk, NOT the
 * index build itself, which sorts in `maintenance_work_mem` (256 MB in this instance, in RAM) and
 * should be faster, plus the time to write ~150 MB of index pages. That points to a low
 * single-digit-second range as a realistic expectation for a single index build, but is NOT a
 * measured index-build time and must NOT be asserted as a hard upper bound on total build time or
 * on the cumulative lock window across all nine tables (none has been measured). Risk framing:
 * this migration runs boot-blockingly at app startup (`migrationsRun`, gated by the `SQL_MIGRATE`
 * env var), so the starting instance itself is not yet serving requests and is not itself a
 * writer. Concurrent writers would be a still-running predecessor instance during a rolling
 * deploy, or external consumers. If a lock conflict occurs, the migration aborts after
 * `lock_timeout` and so does the app start — that is fail-closed and intentional, but it is a
 * deploy abort and must be named as such.
 *
 * Tables and index names:
 *   trading_order              → IDX_47e55a74022f04d725395b9648
 *   crypto_input               → IDX_37d5dbe4bda6e9e78b0ac08ba1
 *   bank_tx                    → IDX_834c06e67196ac958afc5dccec
 *   buy_crypto                 → IDX_398573811cc39fb7ff740459a6
 *   exchange_tx                → IDX_82c40ae44b9968bf6d2c6acdd0
 *   payout_order               → IDX_44c2cf65b5554fb61eef1453c5
 *   buy_fiat                   → IDX_934bb0a02ccf36e8ed04bb6bdd
 *   liquidity_management_order → IDX_6d47b5e8f3e480587a4e3da5a4
 *   liquidity_order            → IDX_617b110d76b02979c229fbc6be
 *
 * These are not arbitrary names but the deterministic names TypeORM's DefaultNamingStrategy would
 * generate itself, since custom index naming is disallowed by CONTRIBUTING.md. Each name is
 * `IDX_` followed by the first 26 hex characters of `sha1(<table> + '_id_updated')` (column names
 * `id` and `updated` sorted alphabetically and joined with `_`, per TypeORM's DefaultNamingStrategy).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLedgerContentChangeScanIndexes1785460000000 {
  name = 'AddLedgerContentChangeScanIndexes1785460000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is scoped to the whole transaction, so set once for all nine CREATE INDEX
    // statements below. Bounds WAIT time to acquire the lock, not how long the lock is held.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_47e55a74022f04d725395b9648" ON "trading_order" ("updated", "id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_37d5dbe4bda6e9e78b0ac08ba1" ON "crypto_input" ("updated", "id")`,
    );

    await queryRunner.query(`CREATE INDEX "IDX_834c06e67196ac958afc5dccec" ON "bank_tx" ("updated", "id")`);

    await queryRunner.query(
      `CREATE INDEX "IDX_398573811cc39fb7ff740459a6" ON "buy_crypto" ("updated", "id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_82c40ae44b9968bf6d2c6acdd0" ON "exchange_tx" ("updated", "id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_44c2cf65b5554fb61eef1453c5" ON "payout_order" ("updated", "id")`,
    );

    await queryRunner.query(`CREATE INDEX "IDX_934bb0a02ccf36e8ed04bb6bdd" ON "buy_fiat" ("updated", "id")`);

    await queryRunner.query(
      `CREATE INDEX "IDX_6d47b5e8f3e480587a4e3da5a4" ON "liquidity_management_order" ("updated", "id")`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_617b110d76b02979c229fbc6be" ON "liquidity_order" ("updated", "id")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // SET LOCAL is scoped to the whole transaction, so set once for all nine DROP INDEX
    // statements below. Bounds WAIT time to acquire the lock, not how long the lock is held.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_617b110d76b02979c229fbc6be"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_6d47b5e8f3e480587a4e3da5a4"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_934bb0a02ccf36e8ed04bb6bdd"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_44c2cf65b5554fb61eef1453c5"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_82c40ae44b9968bf6d2c6acdd0"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_398573811cc39fb7ff740459a6"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_834c06e67196ac958afc5dccec"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_37d5dbe4bda6e9e78b0ac08ba1"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_47e55a74022f04d725395b9648"`);
  }
};
