/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add a composite index on the `notification` table for NotificationService.isSuppressed:
 * findOne({ where: { correlationId, context }, order: { id: 'DESC' } }).
 *
 * Prod Tempo evidence: SELECT on `notification` took up to ~2.5–2.9s on POST /v1/auth/mail.
 * Previously only `userDataId` was indexed on this table, so suppress lookups scanned broadly
 * and sorted by `id` without index support.
 *
 * Column order (`context`, `correlationId`, `id`) is intentional: equality predicates first
 * (`context` + `correlationId`), then `id` for ORDER BY id DESC so the newest match can be
 * served from the index without an explicit Sort. NULL `correlationId` (e.g. LOGIN mails) is
 * still covered — btree indexes store and match NULL keys.
 *
 * What this index does NOT fix: general START/COMMIT tail latency and async mail delivery are
 * out of scope for this migration.
 *
 * CREATE INDEX CONCURRENTLY is not used: migrations in this codebase run transactionally and
 * boot-blockingly (see src/config/config.ts, migrationsRun gated by the SQL_MIGRATE env var).
 * CREATE INDEX CONCURRENTLY is not allowed inside a transaction and would crash the migration.
 *
 * Lock behaviour, stated precisely: a plain CREATE INDEX holds a SHARE lock for the ENTIRE build,
 * not briefly. Reads continue throughout; writes to `notification` block for as long as the build
 * runs. `SET LOCAL lock_timeout` caps only how long we WAIT to acquire that lock, not how long we
 * hold it.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddNotificationSuppressLookupIndex1785500000000 {
  name = 'AddNotificationSuppressLookupIndex1785500000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(
      `CREATE INDEX "IDX_notification_suppress_lookup" ON "notification" ("context", "correlationId", "id")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`DROP INDEX "public"."IDX_notification_suppress_lookup"`);
  }
};
