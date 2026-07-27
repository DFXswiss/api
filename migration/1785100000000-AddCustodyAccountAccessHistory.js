/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds supersede-with-history columns to `custody_account_access` so grant changes stay
 * reconstructible (active + deactivatedAt). Replaces the full unique index on
 * (accountId, userDataId) with a partial unique index that only applies to active rows,
 * so a second grant after revocation (or a level change that inserts a new active row)
 * is possible while inactive history is kept.
 *
 * Constraint/index names are TypeORM's deterministic DefaultNamingStrategy values —
 * `<prefix> + sha1(table + '_' + columns.sort().join('_') [+ '_' + where])` truncated to
 * 26 hex chars for IDX_ — so a future `migration:generate` detects no drift against the
 * entity's @Index decorator.
 *
 * Existing rows are backfilled as active via the column DEFAULT (no separate UPDATE).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCustodyAccountAccessHistory1785100000000 {
  name = 'AddCustodyAccountAccessHistory1785100000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "custody_account_access" ADD "active" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "custody_account_access" ADD "deactivatedAt" TIMESTAMP`);
    // Drop the full unique index so historical (inactive) rows may share (accountId, userDataId).
    await queryRunner.query(`DROP INDEX "public"."IDX_380e225bfd7707fff0e4f98035"`);
    // Partial unique: at most one active grant per (account, grantee).
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_aab22f509e4cf0a1856adefa45" ON "custody_account_access" ("accountId", "userDataId") WHERE "active" = true`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_aab22f509e4cf0a1856adefa45"`);

    // Lossy rollback by nature: after level changes or revoke-and-regrant there are several rows
    // per (accountId, userDataId), so the original full unique index cannot be recreated without
    // first consolidating. Keep the currently active row for each pair; if none is active, keep
    // the most recent row (highest id). Delete remaining history, then restore the old schema.
    await queryRunner.query(`
      DELETE FROM "custody_account_access" AS caa
      WHERE caa."id" NOT IN (
        SELECT kept."id"
        FROM (
          SELECT DISTINCT ON ("accountId", "userDataId") "id"
          FROM "custody_account_access"
          ORDER BY "accountId", "userDataId",
            CASE WHEN "active" = true THEN 0 ELSE 1 END,
            "id" DESC
        ) AS kept
      )
    `);

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_380e225bfd7707fff0e4f98035" ON "custody_account_access" ("accountId", "userDataId")`,
    );
    await queryRunner.query(`ALTER TABLE "custody_account_access" DROP COLUMN "deactivatedAt"`);
    await queryRunner.query(`ALTER TABLE "custody_account_access" DROP COLUMN "active"`);
  }
};
