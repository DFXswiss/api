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
 * Lock behaviour, stated precisely: a plain CREATE INDEX holds a SHARE lock for the ENTIRE build,
 * not briefly. Reads continue throughout; writes to that one table block for as long as the build
 * runs. `SET LOCAL lock_timeout` caps only how long we WAIT to acquire that lock, not how long we
 * hold it once acquired. Production build time for the biggest table's `(updated, id)` scan+sort
 * was measured at 1159 ms — but that number is a `work_mem`-bound External Merge sort spilling
 * ~116 MB to disk, NOT the index build itself, which sorts in `maintenance_work_mem` (256 MB in
 * this instance, in RAM) and should be faster, plus the time to write ~150 MB of index pages. This
 * points to a low single-digit-second range as a realistic expectation, but is NOT a measured
 * index-build time and must NOT be asserted as a hard upper bound. This is judged acceptable
 * because `trading_order` (the busiest/largest of the nine) receives roughly one write every ~20s
 * (~4350 rows/day), and writers retry on lock timeout rather than losing data.
 *
 * Tables and index names:
 *   trading_order              → IDX_trading_order_content_change_scan
 *   crypto_input               → IDX_crypto_input_content_change_scan
 *   bank_tx                    → IDX_bank_tx_content_change_scan
 *   buy_crypto                 → IDX_buy_crypto_content_change_scan
 *   exchange_tx                → IDX_exchange_tx_content_change_scan
 *   payout_order               → IDX_payout_order_content_change_scan
 *   buy_fiat                   → IDX_buy_fiat_content_change_scan
 *   liquidity_management_order → IDX_liquidity_management_order_content_change_scan
 *   liquidity_order            → IDX_liquidity_order_content_change_scan
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
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_trading_order_content_change_scan" ON "trading_order" ("updated", "id")`,
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_crypto_input_content_change_scan" ON "crypto_input" ("updated", "id")`,
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`CREATE INDEX "IDX_bank_tx_content_change_scan" ON "bank_tx" ("updated", "id")`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_buy_crypto_content_change_scan" ON "buy_crypto" ("updated", "id")`,
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_exchange_tx_content_change_scan" ON "exchange_tx" ("updated", "id")`,
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_payout_order_content_change_scan" ON "payout_order" ("updated", "id")`,
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`CREATE INDEX "IDX_buy_fiat_content_change_scan" ON "buy_fiat" ("updated", "id")`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_liquidity_management_order_content_change_scan" ON "liquidity_management_order" ("updated", "id")`,
    );

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_liquidity_order_content_change_scan" ON "liquidity_order" ("updated", "id")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_liquidity_order_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_liquidity_management_order_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_buy_fiat_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_payout_order_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_exchange_tx_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_buy_crypto_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_bank_tx_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_crypto_input_content_change_scan"`);

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_trading_order_content_change_scan"`);
  }
};
