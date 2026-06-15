// Replace the non-unique LOWER(mail) index (added in #3855) with a UNIQUE one to permanently
// prevent duplicate accounts for the same e-mail address.
//
// GATING: this migration MUST NOT be merged/deployed until all existing case-insensitive
// duplicate mails have been resolved (merged or nulled). Otherwise `CREATE UNIQUE INDEX` fails.
// Pre-check (must return zero rows) — the status filter MUST match the index predicate below,
// otherwise merged slaves (which retain their mail) are reported as false collisions and the gate
// can never open:
//   SELECT LOWER(mail), array_agg(id), count(*) FROM user_data
//   WHERE mail IS NOT NULL AND status IN ('Active', 'NA', 'KycOnly', 'Deactivated')
//   GROUP BY LOWER(mail) HAVING count(*) > 1;
//
// PREDICATE: the partial index intentionally mirrors the dedup set used by
// `getUsersByMail(onlyValidUser)` and excludes 'Merged' and 'Blocked' rows. Merged slaves retain
// their mail (mergeUserData does not null it), and blocked duplicates may keep theirs for audit;
// a bare `WHERE mail IS NOT NULL` predicate would break on historical merges and on every future
// merge. Scoping to the active set keeps uniqueness consistent with the lookup that enforces it.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

module.exports = class AddUserDataMailLowerUniqueIndex1781016011873 {
  name = 'AddUserDataMailLowerUniqueIndex1781016011873';

  async up(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_user_data_mail_lower"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_user_data_mail_lower" ON "user_data" (LOWER("mail")) WHERE "mail" IS NOT NULL AND "status" IN ('Active', 'NA', 'KycOnly', 'Deactivated')`,
    );
  }

  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_user_data_mail_lower"`);
    await queryRunner.query(`CREATE INDEX "IDX_user_data_mail_lower" ON "user_data" (LOWER("mail"))`);
  }
};
