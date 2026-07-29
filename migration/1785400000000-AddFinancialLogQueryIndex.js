/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add a composite index on the `log` table to cut disk I/O and remove the explicit Sort step
 * from the minute-interval LedgerMarkService production query.
 *
 * The `log` table is the largest table in the database at 1353 MB (527339 rows) and previously
 * had only the primary key as an index. LedgerMarkService runs a query every minute that filters
 * on `system`, `subsystem`, `severity`, `valid` and a `created` range, then orders by
 * `created, id`.
 *
 * EXPLAIN (ANALYZE, BUFFERS) in production without this index showed a Parallel Seq Scan followed
 * by an explicit Sort, reading 86270 blocks (~674 MB) from disk per call, discarding 175629 rows
 * per parallel worker at the filter, and taking 86 ms with correspondingly high disk load.
 *
 * Column order (system, subsystem, severity, valid, created) is intentional: four equality
 * predicates first, then the range/sort column `created` last. Postgres can use the index for
 * both filtering and ORDER BY, avoiding the separate Sort step.
 *
 * What this index does NOT fix: disk I/O and Sort are addressed, but not the transferred payload.
 * The query still returns up to 5001 rows with an average 5.8 KB `message` column (~47 MB per
 * call), which continues to pressure the Node event loop. That is a separate open topic and
 * explicitly out of scope for this migration.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see src/config/config.ts, migrationsRun gated by the SQL_MIGRATE env var).
 * CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the migration.
 *
 * A short SHARE lock during a plain CREATE INDEX is acceptable: reads continue while the index
 * builds; only writes to `log` block briefly. The table grows by about 2900 rows per day
 * (~2 per minute), so a brief write lock is not critical.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFinancialLogQueryIndex1785400000000 {
  name = 'AddFinancialLogQueryIndex1785400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_log_financial_query" ON "log" ("system", "subsystem", "severity", "valid", "created")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "IDX_log_financial_query"`);
  }
};
