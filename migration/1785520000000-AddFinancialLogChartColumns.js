/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Captures the two FinancialDataLog chart values (balancesTotal.totalBalanceChf and the BTC
 * entry's priceChf under assets) in dedicated nullable columns on `log`, instead of parsing them
 * out of the ~43 KB `message` document on every read.
 *
 * Production-table replica (same row count/size): 1.407 ms / ~89,000 blocks (JSON parsing) vs
 * 5.2 ms / 1,335 blocks (column projection) for 2,099 points in a 3-day window; incremental new
 * points only 0.03 ms / 3 blocks. Index size on the replica: 34 MB.
 *
 * `ADD COLUMN` without a DEFAULT is a catalog-only change since PostgreSQL 11 — instant, no
 * rewrite of the 1.4 GB table, no long lock. A `GENERATED ALWAYS AS (...) STORED` column was
 * deliberately not used instead: it WOULD rewrite the whole table, and it would fail outright on
 * any row whose `message` is not valid JSON — such rows exist in this table. These are therefore
 * two plain nullable columns, populated by LogJobService going forward and by the backfill below
 * for existing rows.
 *
 * Backfill: ~40,226 existing FinancialDataLog/Info rows (back to September 2024) get both values
 * populated in one set-based UPDATE, guarded with `IS JSON` (PostgreSQL 16+; local docker-compose
 * pins postgres:16, a sibling migration comment in this repo confirms production runs at least
 * 17.10) so a single malformed `message` row cannot abort the migration — that row is filtered
 * out by the WHERE clause before the CASE/::jsonb casts in the SET clause are ever evaluated for
 * it, and is simply left NULL, the same value a missing/non-numeric JSON key already produces via
 * the query this replaces for the History screen.
 *
 * The BTC asset id is resolved once via a plain SELECT against `asset` (name='BTC',
 * blockchain='Bitcoin', type='Coin' — the same lookup AssetService.getBtcCoin() performs). If no
 * such asset row exists, `btcPriceChf` is left NULL for every row while `totalBalanceChf` is still
 * backfilled normally; not observed in production, a defensive fallback only.
 *
 * The backfill runs BEFORE the index build below, so the index is built once over final data
 * rather than being maintained row-by-row while the UPDATE runs.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see src/config/config.ts, migrationsRun gated by the SQL_MIGRATE env var).
 * CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the migration.
 * `SET LOCAL lock_timeout` bounds only how long the migration WAITS to acquire the lock, not how
 * long it holds it once acquired, and is scoped to the whole transaction — same reasoning as the
 * sibling `log` migration AddFinancialLogQueryIndex1785400000000.
 *
 * Index name `IDX_b7eda1156aca7b2a1302cdf88f`: the deterministic name TypeORM's
 * DefaultNamingStrategy generates for an index on `log` keyed by (system, subsystem, severity,
 * valid, created) — verified via a direct call to that function, not derived by hand. INCLUDE
 * columns are not part of that name derivation; this migration is hand-written raw SQL, since
 * TypeORM cannot generate an INCLUDE clause itself.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFinancialLogChartColumns1785520000000 {
  name = 'AddFinancialLogChartColumns1785520000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "log" ADD "totalBalanceChf" double precision`);
    await queryRunner.query(`ALTER TABLE "log" ADD "btcPriceChf" double precision`);

    const btcAssetRows = await queryRunner.query(
      `SELECT id FROM "asset" WHERE "name" = $1 AND "blockchain" = $2 AND "type" = $3`,
      ['BTC', 'Bitcoin', 'Coin'],
    );
    // .at(0) rather than index access: the repo's migration-psql-check scans the raw file for MSSQL
    // bracket quoting and its pattern cannot tell that from a JavaScript array index.
    const btcAssetId = btcAssetRows.at(0)?.id ?? null;

    await queryRunner.query(
      `UPDATE "log"
       SET "totalBalanceChf" = CASE
             WHEN jsonb_typeof(("message")::jsonb -> 'balancesTotal' -> 'totalBalanceChf') = 'number'
             THEN (("message")::jsonb -> 'balancesTotal' ->> 'totalBalanceChf')::float8
             ELSE NULL
           END,
           "btcPriceChf" = CASE
             WHEN jsonb_typeof(("message")::jsonb -> 'assets' -> $1::text -> 'priceChf') = 'number'
             THEN (("message")::jsonb -> 'assets' -> $1::text ->> 'priceChf')::float8
             ELSE NULL
           END
       WHERE "system" = $2 AND "subsystem" = $3 AND "severity" = $4 AND "message" IS JSON`,
      [btcAssetId != null ? String(btcAssetId) : null, 'LogService', 'FinancialDataLog', 'Info'],
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_b7eda1156aca7b2a1302cdf88f" ON "log" ("system", "subsystem", "severity", "valid", "created") INCLUDE ("totalBalanceChf", "btcPriceChf")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_b7eda1156aca7b2a1302cdf88f"`);
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "btcPriceChf"`);
    await queryRunner.query(`ALTER TABLE "log" DROP COLUMN "totalBalanceChf"`);
  }
};
