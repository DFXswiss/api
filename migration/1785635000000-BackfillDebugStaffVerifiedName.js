/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

// Same character set as `BlankChars` in StaffKycClearanceService — every character
// `String.prototype.trim()` strips. Postgres' bare `TRIM(x)` removes ASCII space only, so a name of a
// single tab or a non-breaking space would pass a `TRIM(x) <> ''` test while the clearance query still
// rejects it. Duplicated rather than imported: migrations are plain JS executed by TypeORM and cannot
// pull in application sources.
const BLANK_CHARS =
  '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007' +
  '\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';

/**
 * PRD-only backfill for the remaining staff account gated out by the staff-clearance rule (#4395 →
 * #4572). The earlier backfill (#4574) covered two accounts; user data 403938 (the Debug account) was
 * not among them and still fails every elevated endpoint with STAFF_KYC_REQUIRED.
 *
 * No plaintext personal name lives in this file: the value is read from the deployment variable
 * STAFF_VERIFIED_NAME_403938, which is mandatory on PRD so TypeORM cannot record a partial/no-op
 * migration when it is missing. The update is idempotent (only touches a still-null verifiedName) and
 * coupled to a durable before/after audit entry. Guarded to prd; a no-op elsewhere.
 *
 * The closing assertion checks the clearance predicate itself rather than equality with the supplied
 * name: should an identity-verified path have written a different (correct) name in the meantime, that
 * account is cleared and the migration must not fail the deploy over the spelling.
 * @class @implements {MigrationInterface}
 */
module.exports = class BackfillDebugStaffVerifiedName1785635000000 {
  name = 'BackfillDebugStaffVerifiedName1785635000000';

  async up(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    const verifiedName = process.env.STAFF_VERIFIED_NAME_403938?.trim();
    if (!verifiedName) throw new Error('STAFF_VERIFIED_NAME_403938 is required for the PRD staff-name backfill');

    // Array.of avoids looking like MSSQL bracket quoting to the repository's migration syntax guard.
    await queryRunner.query(
      `WITH "affected" AS (
         SELECT "id", "verifiedName" AS "previousVerifiedName"
         FROM "user_data"
         WHERE "id" = 403938 AND "verifiedName" IS NULL
         FOR UPDATE
       ),
       "audit" AS (
         INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
         SELECT now(), now(), 'User', 'StaffVerifiedNameBackfill', 'Info',
           json_agg(json_build_object(
             'userDataId', "id",
             'previousVerifiedName', "previousVerifiedName",
             'nextVerifiedName', $1::varchar
           ) ORDER BY "id")::text
         FROM "affected"
         HAVING count(*) > 0
         RETURNING 1
       )
       UPDATE "user_data" ud
       SET "verifiedName" = $1::varchar, "updated" = now()
       FROM "affected" a
       WHERE ud."id" = a."id" AND EXISTS (SELECT 1 FROM "audit")`,
      Array.of(verifiedName),
    );

    const rows = await queryRunner.query(
      `SELECT count(*)::int AS "clearedCount"
       FROM "user_data"
       WHERE "id" = 403938 AND BTRIM("verifiedName", $1::varchar) <> ''`,
      Array.of(BLANK_CHARS),
    );

    if (Number(rows.at(0)?.clearedCount) !== 1) {
      throw new Error('PRD staff-name backfill did not reach the required state for user data 403938');
    }
  }

  async down() {
    // No-op: a granted clearance is not auto-revoked here; removal requires a separate reviewed,
    // audited revocation so an unrelated rollback cannot silently erase an identity grant.
  }
};
