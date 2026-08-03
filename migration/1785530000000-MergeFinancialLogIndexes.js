/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Replace the two near-identical `log` indexes with a single combined index that serves both
 * access paths.
 *
 * Starting point, measured in production:
 * - `IDX_log_financial_query` on (system, subsystem, severity, valid, created, id) — 46 MB,
 *   16687 idx_scan. Created by AddFinancialLogQueryIndex1785400000000.
 * - `IDX_b7eda1156aca7b2a1302cdf88f` on (system, subsystem, severity, valid, created)
 *   INCLUDE ("totalBalanceChf", "btcPriceChf") — 42 MB, 25 idx_scan. Created by
 *   AddFinancialLogChartColumns1785520000000.
 *
 * The second index exists so the Overview chart query would be served by an Index Only Scan. It
 * does not achieve that. The query selects `created, id, "totalBalanceChf", "btcPriceChf"` (see
 * `LogRepository.getFinancialLogSummariesChartOnly`), and `id` is neither a key column nor an
 * INCLUDE column of that index — so an Index Only Scan is impossible and the planner falls back to
 * `IDX_log_financial_query`. What is left is a strictly narrower key prefix of the older index plus
 * two payload columns that no plan can reach without a heap visit anyway: practically redundant
 * rather than complementary, which the 25 scans against 16687 confirm.
 *
 * Production `EXPLAIN (ANALYZE, BUFFERS)`, both over the full 33136-row result (the query carries
 * no LIMIT: its only caller passes `to`, `limit` and `after` as undefined throughout):
 * - The real query, with `id` in the select list: Index Scan using `IDX_log_financial_query`,
 *   Buffers hit=2806 read=9222, 163.2 ms.
 * - The same query with `id` removed from the select list: Index Only Scan using
 *   `IDX_b7eda1156aca7b2a1302cdf88f`, Heap Fetches 91, Buffers hit=2272 read=623, 12.8 ms.
 * The conclusion this migration draws from those two numbers: the chart index was not worthless,
 * it was cut wrong. The index-only plan it was meant to enable is roughly 13x faster and reads an
 * order of magnitude fewer blocks from disk; the single column `id` is all that separates the two
 * plans.
 *
 * The combined index fixes exactly that and nothing else. Its key columns
 * (system, subsystem, severity, valid, created, id) are identical to those of
 * `IDX_log_financial_query`, so every access path that index serves today — all 16687 scans,
 * including the per-minute LedgerMarkService query it was built for — is served unchanged by the
 * replacement, with the same ordering and the same selectivity. On top of that it carries
 * "totalBalanceChf" and "btcPriceChf" as INCLUDE columns: payload only, not part of the key, so
 * they change neither the ordering nor the search behaviour, but the chart query now finds all
 * four of its selected columns inside the index and becomes Index-Only-Scan-capable. One index
 * does both jobs, so both old ones are dropped.
 *
 * Index name `IDX_5e9ca4be25d4b828fe02a2dddf`: not a chosen name — custom index names are
 * disallowed by CONTRIBUTING.md — but the deterministic name TypeORM's DefaultNamingStrategy
 * produces for an index on `log` keyed by (system, subsystem, severity, valid, created, id):
 * `IDX_` followed by the first 26 hex characters of
 * sha1('log_created_id_severity_subsystem_system_valid') (table name, `_`, then the key column
 * names sorted alphabetically and joined with `_`). INCLUDE columns are not part of that
 * derivation. The formula was cross-checked by reproducing the existing name
 * `IDX_b7eda1156aca7b2a1302cdf88f` from sha1('log_created_severity_subsystem_system_valid').
 * The physical key order stays (system, subsystem, severity, valid, created, id) as the access
 * paths require; only the name derivation sorts the column names.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see `src/config/config.ts`, `migrationsRun` gated by the `SQL_MIGRATE` env var).
 * CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the migration —
 * the same reasoning as in the two predecessor migrations named above.
 *
 * Lock behaviour, stated precisely and without gloss: all pending migrations run inside a single
 * database transaction (TypeORM default `migrationsTransactionMode: "all"`; see
 * `node_modules/typeorm/data-source/DataSource.js`, `migrationExecutor.transaction =
 * options?.transaction || this.options?.migrationsTransactionMode || "all"`, and
 * `src/config/config.ts`, which sets only `migrationsRun` and never overrides that mode), and
 * PostgreSQL releases locks at COMMIT, not at the end of each statement.
 * - The `CREATE INDEX` holds a SHARE lock for the ENTIRE build, not briefly. Reads on `log`
 *   continue throughout; writes to `log` block for as long as the build runs.
 * - Each `DROP INDEX` takes ACCESS EXCLUSIVE, which conflicts with every other lock mode including
 *   the AccessShareLock of a plain SELECT. Held until the migration transaction commits, it blocks
 *   reads on `log` as well as writes for that entire remaining window.
 * The statement order in `up()` follows from this: build first, drop last, so the ACCESS EXCLUSIVE
 * window starts as late as possible instead of also spanning the index build. It cannot be avoided,
 * only kept short. For the same reason this migration is best deployed on its own: any other
 * pending migration in the same batch stretches the window in which `log` is unreadable out to the
 * shared COMMIT.
 * `SET LOCAL lock_timeout` bounds only how long we WAIT to acquire a lock, never how long we hold
 * it once acquired, and it is scoped to the whole transaction — hence set once at the top of `up()`
 * and once at the top of `down()`, not per statement.
 * `log` is 688 MB over 528920 rows. The build duration has not been measured against production
 * data, so no upper bound is claimed here.
 *
 * No `IF EXISTS` / `IF NOT EXISTS` anywhere, deliberately: if one of the two expected indexes is
 * already gone, the premise of this migration no longer holds, and it must fail loudly instead of
 * quietly doing half the work and leaving the table in a state nobody described.
 *
 * The columns "totalBalanceChf" and "btcPriceChf" themselves are not touched. They are owned by
 * AddFinancialLogChartColumns1785520000000; this migration only reshapes indexes.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class MergeFinancialLogIndexes1785530000000 {
  name = 'MergeFinancialLogIndexes1785530000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire a lock, not how
    // long a lock is held. Set once for all statements below.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    // Build first, drop last: keeps the ACCESS EXCLUSIVE window of the two DROPs as short as the
    // single migration transaction allows.
    await queryRunner.query(
      `CREATE INDEX "IDX_5e9ca4be25d4b828fe02a2dddf" ON "log" ("system", "subsystem", "severity", "valid", "created", "id") INCLUDE ("totalBalanceChf", "btcPriceChf")`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_b7eda1156aca7b2a1302cdf88f"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_log_financial_query"`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // SET LOCAL is scoped to the whole transaction. Bounds WAIT time to acquire a lock, not how
    // long a lock is held. Set once for all statements below.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    // Exact inverse of up(): both predecessor indexes are recreated verbatim as their originating
    // migrations wrote them, and only then is the combined index dropped.
    await queryRunner.query(
      `CREATE INDEX "IDX_b7eda1156aca7b2a1302cdf88f" ON "log" ("system", "subsystem", "severity", "valid", "created") INCLUDE ("totalBalanceChf", "btcPriceChf")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_log_financial_query" ON "log" ("system", "subsystem", "severity", "valid", "created", "id")`,
    );
    await queryRunner.query(`DROP INDEX "public"."IDX_5e9ca4be25d4b828fe02a2dddf"`);
  }
};
