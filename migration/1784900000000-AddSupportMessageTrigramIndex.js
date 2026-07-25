/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Backs the support dashboard's free-text search (SupportIssueService.getSupportIssueList). Each
 * search term expands to a predicate ending in
 *   EXISTS (SELECT 1 FROM support_message m WHERE m."issueId" = issue.id AND m.message LIKE '%term%')
 * A leading-wildcard LIKE cannot use a b-tree index, so both the page query and — far more
 * expensively — the getManyAndCount total had to read every message row, on every search and again
 * on every "load more".
 *
 * Measured on a seeded copy at production cardinality (8.6k issues / 94.6k messages):
 *   rows (take 20)   25.3 ms -> 12.2 ms
 *   count (total)    61.6 ms ->  7.0 ms
 *   getManyAndCount 110.7 ms -> 17.8 ms
 *
 * Only support_message.message is indexed: trigram indexes on issue.name / user_data.firstname /
 * surname were measured too and moved the combined query by ~3 ms, which does not justify three more
 * GIN indexes.
 *
 * WHY THIS DOES NOT HARD-FAIL WITHOUT pg_trgm
 * TypeORM runs all pending migrations in ONE transaction at boot, so any raw failure here rolls the
 * whole batch back and leaves the API unable to start — an outage caused by a pure performance
 * index. There are several independent ways this can fail, and a privilege check alone does not
 * cover them: the role may not hold CREATE on the database; the extension may not be present on the
 * server or not allow-listed by a managed provider; or it may be installed into a schema outside the
 * search_path, in which case pg_extension reports it as present but `gin_trgm_ops` still does not
 * resolve. Each of those aborts the surrounding transaction.
 *
 * Both DDL statements are therefore wrapped in PL/pgSQL EXCEPTION blocks. Catching in JS would not
 * help — a failed statement poisons the Postgres transaction, and control never returns in a usable
 * state — but a PL/pgSQL EXCEPTION block opens an implicit subtransaction, so the failure is
 * contained and the outer batch survives. Verified against a real Postgres for the unavailable
 * extension, the unprivileged role, and the out-of-search_path opclass.
 *
 * `query_canceled` is listed explicitly: Postgres excludes it from WHEN OTHERS, so a server- or
 * role-level statement_timeout shorter than the index build would otherwise abort the batch after
 * all. `lock_timeout` (55P03) is covered by WHEN OTHERS and needs no separate arm. The cost of
 * catching 57014 is that an operator's pg_cancel_backend() aimed at a slow index build is swallowed
 * too - cancelling this statement specifically requires pg_terminate_backend.
 *
 * The failure degrades to "index skipped, search stays slow" with a NOTICE carrying SQLERRM.
 * `logNotifications` is enabled on the data source, so that line reaches stdout/Loki.
 *
 * If that NOTICE appears, search stays slow and NOTHING retries automatically — TypeORM records this
 * migration as applied either way. Installing the extension afterwards therefore needs a follow-up
 * migration that creates the index alone.
 *
 * Plain CREATE INDEX, not CONCURRENTLY - CONCURRENTLY is not allowed inside a transaction, and
 * overriding the transaction mode is not an option either: TypeORM throws
 * ForbiddenTransactionModeOverrideError when one migration opts out while the batch runs under
 * `all`, which would be a guaranteed boot failure.
 *
 * The lock is a ShareLock on support_message, verified on a 94.6k-row table: SELECT keeps working,
 * INSERT blocks. And because the batch runs in ONE transaction, that lock is held from this
 * statement until the WHOLE batch commits - not just for the index build itself, which measured
 * roughly 4-6 s on that table depending on maintenance_work_mem (GIN ~16 MB next to a ~13 MB table;
 * laptop figures that scale with the row count - an order of magnitude, not a guarantee). New
 * support and customer messages cannot be written for the duration of the deploy's migration batch.
 * The table is append-only from replies and the window is short, but a release carrying several slow
 * migrations is a reason to ship this one on its own. The lock_timeout below bounds the wait if a
 * writer is already holding a conflicting lock when the deploy starts.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSupportMessageTrigramIndex1784900000000 {
  name = 'AddSupportMessageTrigramIndex1784900000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
          BEGIN
            EXECUTE 'CREATE EXTENSION pg_trgm';
          EXCEPTION WHEN OTHERS OR query_canceled THEN
            RAISE NOTICE 'AddSupportMessageTrigramIndex: pg_trgm could not be installed (%) - the support search index was SKIPPED and the dashboard search stays slow. Install pg_trgm and add the index in a follow-up migration.', SQLERRM;
            RETURN;
          END;
        END IF;

        BEGIN
          -- bounded wait: without it a conflicting lock on support_message would make CREATE INDEX
          -- block forever and the API would never finish booting. A timeout lands in the handler
          -- below, i.e. it degrades to the same "index skipped" outcome as every other failure here.
          SET LOCAL lock_timeout = '5s';
          CREATE INDEX IF NOT EXISTS "IDX_support_message_message_trgm"
            ON "support_message" USING gin ("message" gin_trgm_ops);
          -- SET LOCAL is transaction-scoped, not block-scoped, and this subtransaction COMMITS on
          -- the success path: without the reset every later migration in the same batch would run
          -- with a 5s lock timeout and no handler of its own, so a contended ALTER TABLE elsewhere
          -- would fail fast and roll the batch back. (On the exception path the subtransaction
          -- aborts and the setting is restored anyway.)
          SET LOCAL lock_timeout = DEFAULT;
        EXCEPTION WHEN OTHERS OR query_canceled THEN
          RAISE NOTICE 'AddSupportMessageTrigramIndex: the support search index was SKIPPED (%) and the dashboard search stays slow. Add the index in a follow-up migration once the cause is resolved.', SQLERRM;
        END;
      END $$;
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // IF EXISTS because up() legitimately skips the index when the extension is unavailable. The
    // extension itself is left alone: it may predate this migration, and dropping it would CASCADE
    // into every object built on it.
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_support_message_message_trgm"`);
  }
};
