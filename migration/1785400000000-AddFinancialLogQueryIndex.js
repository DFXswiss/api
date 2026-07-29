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
 * Column order (system, subsystem, severity, valid, created, id) is intentional: four equality
 * predicates first, then the two ORDER BY columns in query order. `id` is part of the index
 * rather than trailing it: the query orders by `created, id`, so an index ending at `created`
 * would still need a sort step whenever several rows share a `created` value — which happens,
 * since the table is written at roughly two rows per minute.
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
 * Lock behaviour, stated precisely: a plain CREATE INDEX holds a SHARE lock for the ENTIRE build,
 * not briefly. Reads continue throughout; writes to `log` block for as long as the build runs over
 * the 1353 MB table. `SET LOCAL lock_timeout` caps only how long we WAIT to acquire that lock, not
 * how long we hold it. The build duration has not been measured against production data, so no
 * upper bound is claimed here. This is judged acceptable because `log` takes only about 2900 rows
 * per day (~2 per minute) and those writes are retried by their jobs, not lost.
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
      `CREATE INDEX "IDX_log_financial_query" ON "log" ("system", "subsystem", "severity", "valid", "created", "id")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_log_financial_query"`);
  }
};
