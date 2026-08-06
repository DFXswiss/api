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

// Support account on DEV, targeted by wallet address (same pattern as the Compliance account in
// 1785742000000). Matching is case-insensitive — EIP-55 checksummed form vs stored casing must not
// decide a boot-fatal assertion.
const SUPPORT_ACCOUNT_ADDRESS = '0xA6a045551b210781D98725e9274af419f0602f72';

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class GrantSupportRoleOnDev1785950000000 {
  name = 'GrantSupportRoleOnDev1785950000000';

  /**
   * On DEV only: (1) ensure staff KYC clearance for the Support account (non-blank verifiedName on
   * its user_data, via STAFF_VERIFIED_NAME_DEV_SUPPORT), then (2) grant Support role when the user currently has User.
   * Role update and audit log insert run in one statement so a failed audit aborts the role change
   * (fail-closed, CONTRIBUTING auditable mutations). Same for the verifiedName backfill.
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // DEV-only: this grant is scoped to the DEV environment. Whether the same
    // address exists elsewhere is unchecked; never elevate roles outside DEV.
    if (process.env.ENVIRONMENT !== 'dev') return;

    const verifiedName = process.env.STAFF_VERIFIED_NAME_DEV_SUPPORT?.trim();
    if (!verifiedName) throw new Error('STAFF_VERIFIED_NAME_DEV_SUPPORT is required for the DEV staff-name backfill');

    // Precondition (before any write): exactly one user_data behind LOWER(address). Multiple address
    // casings of the same account still yield 1; two different accounts behind the same address yield
    // > 1 and must fail closed before clearance stamps verifiedName on either. docs/staff-kyc-clearance.md
    // requires exactly one cleared row — counting first keeps a multi-account collision from ever writing.
    const preconditionRows = await queryRunner.query(
      `SELECT count(*)::int AS "targetCount"
       FROM "user_data" ud
       WHERE ud."id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($1::varchar))`,
      Array.of(SUPPORT_ACCOUNT_ADDRESS),
    );

    if (Number(preconditionRows.at(0)?.targetCount) !== 1) {
      throw new Error(
        'DEV staff-name backfill precondition failed: Support account must resolve to exactly one user_data',
      );
    }

    // `needsBackfill` is the exact negation of the blankCount postcondition below (blankness including NULL).
    // `noteworthy` audits repairs and deliberate keep-existing-name decisions; a re-run after a
    // successful backfill is a true no-op (no audit row). Array.of avoids looking like MSSQL bracket
    // quoting to the repository's migration syntax guard.
    await queryRunner.query(
      `WITH "targets" AS (
         SELECT "id",
                "verifiedName" AS "previousVerifiedName",
                BTRIM(COALESCE("verifiedName", ''), $2::varchar) = '' AS "needsBackfill"
         FROM "user_data"
         WHERE "id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($3::varchar))
         FOR UPDATE
       ),
       "noteworthy" AS (
         SELECT "id", "previousVerifiedName", "needsBackfill"
         FROM "targets"
         WHERE "needsBackfill" OR "previousVerifiedName" IS DISTINCT FROM $1::varchar
       ),
       "audit" AS (
         INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
         SELECT now(), now(), 'User', 'StaffVerifiedNameBackfill', 'Info',
           json_agg(json_build_object(
             'userDataId', "id",
             'previousVerifiedName', "previousVerifiedName",
             'nextVerifiedName', CASE WHEN "needsBackfill" THEN $1::varchar ELSE "previousVerifiedName" END,
             'action', CASE WHEN "needsBackfill" THEN 'backfilled' ELSE 'keptExistingName' END
           ) ORDER BY "id")::text
         FROM "noteworthy"
         HAVING count(*) > 0
         RETURNING 1
       )
       UPDATE "user_data" ud
       SET "verifiedName" = $1::varchar, "updated" = now()
       FROM "targets" t
       WHERE ud."id" = t."id" AND t."needsBackfill" AND EXISTS (SELECT 1 FROM "audit")`,
      Array.of(verifiedName, BLANK_CHARS, SUPPORT_ACCOUNT_ADDRESS),
    );

    // Postcondition: clearance predicate (not equality with the supplied name). blankCount must be 0;
    // targetCount is re-checked so a concurrent change between the precondition and the UPDATE still
    // fails closed with a message that operators can tell from the precondition failure above.
    const postconditionRows = await queryRunner.query(
      `SELECT
         (SELECT count(*)::int FROM "user_data" ud
          WHERE ud."id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($2::varchar))) AS "targetCount",
         (SELECT count(*)::int FROM "user_data" ud
          WHERE ud."id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($2::varchar))
            AND BTRIM(COALESCE(ud."verifiedName", ''), $1::varchar) = '') AS "blankCount"`,
      Array.of(BLANK_CHARS, SUPPORT_ACCOUNT_ADDRESS),
    );

    if (Number(postconditionRows.at(0)?.targetCount) !== 1 || Number(postconditionRows.at(0)?.blankCount) !== 0) {
      throw new Error(
        'DEV staff-name backfill postcondition failed: Support account did not reach a single non-blank verifiedName',
      );
    }

    await queryRunner.query(
      `
            WITH "affected" AS (
                UPDATE "user"
                SET "role" = 'Support'
                WHERE LOWER("address") = LOWER($1::varchar)
                  AND "role" = 'User'
                RETURNING "id"
            )
            INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message", "category")
            SELECT
                now(), now(),
                'User',
                'GrantSupportRoleOnDev',
                'Info',
                jsonb_build_object(
                    'migration', 'GrantSupportRoleOnDev1785950000000',
                    'direction', 'up',
                    'affectedCount', count(*),
                    'userIds', string_agg("id"::text, ','),
                    'fromRole', 'User',
                    'toRole', 'Support'
                )::text,
                'up'
            FROM "affected"
        `,
      Array.of(SUPPORT_ACCOUNT_ADDRESS),
    );
  }

  /**
   * Revert: restore User role for the same address, only if currently Support and only for ids
   * recorded in an up() audit with affectedCount > 0 (membership on userIds — not every Support
   * row that merely matches the address).
   * Update and audit log insert run in one statement so a failed audit aborts the role change
   * (fail-closed, CONTRIBUTING auditable mutations).
   *
   * Clearance is never auto-revoked by the migration's down(): verifiedName stays set so an
   * unrelated rollback cannot silently erase an identity grant (docs/staff-kyc-clearance.md).
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // DEV-only: mirror the up() environment gate so down() never touches other envs.
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(
      `
            WITH "affected" AS (
                UPDATE "user"
                SET "role" = 'User'
                WHERE LOWER("address") = LOWER($1::varchar)
                  AND "role" = 'Support'
                  AND "id"::text = ANY (
                      SELECT UNNEST(string_to_array("audited"."message"::jsonb ->> 'userIds', ','))
                      FROM (
                          SELECT "message" FROM "log"
                          WHERE "system" = 'User'
                            AND "subsystem" = 'GrantSupportRoleOnDev'
                            AND "category" = 'up'
                          OFFSET 0
                      ) "audited"
                      WHERE ("audited"."message"::jsonb ->> 'affectedCount')::int > 0
                  )
                RETURNING "id"
            )
            INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message", "category")
            SELECT
                now(), now(),
                'User',
                'GrantSupportRoleOnDev',
                'Info',
                jsonb_build_object(
                    'migration', 'GrantSupportRoleOnDev1785950000000',
                    'direction', 'down',
                    'affectedCount', count(*),
                    'userIds', string_agg("id"::text, ','),
                    'fromRole', 'Support',
                    'toRole', 'User'
                )::text,
                'down'
            FROM "affected"
        `,
      Array.of(SUPPORT_ACCOUNT_ADDRESS),
    );
  }
};
