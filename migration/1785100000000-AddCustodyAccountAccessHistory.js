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
    // Refuse when inactive history exists: both consolidations are lossy (delete history, or
    // resurrect revoked grants after dropping `active`). Count first so a refused rollback
    // leaves the schema completely untouched.
    const inactiveCount = (
      await queryRunner.query(`SELECT COUNT(*)::int AS count FROM "custody_account_access" WHERE "active" = false`)
    ).at(0).count;

    if (inactiveCount > 0) {
      throw new Error(
        `Cannot roll back AddCustodyAccountAccessHistory: ${inactiveCount} inactive custody_account_access row(s) exist. ` +
          'Both consolidations are lossy — deleting inactive rows destroys grant history; keeping them and ' +
          'recreating the full unique index would resurrect revoked grants once the active column is gone. ' +
          'Archive or consolidate custody_account_access deliberately, then run the rollback again.',
      );
    }

    await queryRunner.query(`DROP INDEX "public"."IDX_aab22f509e4cf0a1856adefa45"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_380e225bfd7707fff0e4f98035" ON "custody_account_access" ("accountId", "userDataId")`,
    );
    await queryRunner.query(`ALTER TABLE "custody_account_access" DROP COLUMN "deactivatedAt"`);
    await queryRunner.query(`ALTER TABLE "custody_account_access" DROP COLUMN "active"`);
  }
};
