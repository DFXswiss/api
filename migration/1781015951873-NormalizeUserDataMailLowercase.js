// Normalize all stored e-mail addresses to lowercase and add a functional index on LOWER(mail).
//
// Background: input lowercase-normalization (Util.toLowerCaseTrim) only arrived with PR #2695
// (2025-12-23), so accounts created earlier hold mixed-case mails. After the MSSQL->PostgreSQL
// cutover (PR #3620, 2026-05-22) the duplicate-detection lookup `getUsersByMail` (exact `mail = ?`)
// became case-sensitive and stopped matching those mixed-case rows, allowing duplicate accounts
// for the same address (e.g. `Samuel.kullmann@...` vs `samuel.kullmann@...`).
//
// This migration lowercases the legacy data so it is consistent with the now case-insensitive
// lookup. The index is intentionally NON-unique here: case-collision duplicates still exist and
// must be resolved via the merge campaign before the UNIQUE variant can be created (separate PR).
//
// Note: lowercasing is lossy (original casing is not recoverable), so `down` is a no-op for the
// data updates and only drops the index.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class NormalizeUserDataMailLowercase1781015951873 {
  name = 'NormalizeUserDataMailLowercase1781015951873';

  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "user_data" SET "mail" = LOWER("mail") WHERE "mail" IS NOT NULL AND "mail" <> LOWER("mail")`,
    );
    await queryRunner.query(
      `UPDATE "recommendation" SET "recommendedMail" = LOWER("recommendedMail") WHERE "recommendedMail" IS NOT NULL AND "recommendedMail" <> LOWER("recommendedMail")`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_user_data_mail_lower" ON "user_data" (LOWER("mail"))`);
  }

  async down(queryRunner) {
    // Data lowercasing is irreversible; only the index is dropped.
    await queryRunner.query(`DROP INDEX "public"."IDX_user_data_mail_lower"`);
  }
};
