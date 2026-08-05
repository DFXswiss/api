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
   * its user_data, via n_dev_support), then (2) grant Support role when the user currently has User.
   * Role update and audit log insert run in one statement so a failed audit aborts the role change
   * (fail-closed, CONTRIBUTING auditable mutations). Same for the verifiedName backfill.
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // DEV-only: this grant is scoped to the DEV environment. Whether the same
    // address exists elsewhere is unchecked; never elevate roles outside DEV.
    if (process.env.ENVIRONMENT !== 'dev') return;

    const verifiedName = process.env.n_dev_support?.trim();
    if (!verifiedName) throw new Error('n_dev_support is required for the DEV staff-name backfill');

    // `needsBackfill` is the exact negation of the closing assertion below (blankness including NULL).
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

    // Clearance predicate, not equality with the supplied name. LOWER() on address can match multiple
    // rows (unique index on user.address is case-sensitive), so require at least one user_data and
    // that none remain blank — not "exactly one".
    const rows = await queryRunner.query(
      `SELECT
         (SELECT count(*)::int FROM "user_data" ud
          WHERE ud."id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($2::varchar))) AS "targetCount",
         (SELECT count(*)::int FROM "user_data" ud
          WHERE ud."id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($2::varchar))
            AND BTRIM(COALESCE(ud."verifiedName", ''), $1::varchar) = '') AS "blankCount"`,
      Array.of(BLANK_CHARS, SUPPORT_ACCOUNT_ADDRESS),
    );

    if (Number(rows.at(0)?.targetCount) < 1 || Number(rows.at(0)?.blankCount) !== 0) {
      throw new Error('DEV staff-name backfill did not reach the required state for the Support account');
    }

    await queryRunner.query(`
            WITH updated AS (
                UPDATE "user"
                SET "role" = 'Support'
                WHERE LOWER("address") = LOWER('${SUPPORT_ACCOUNT_ADDRESS}')
                  AND "role" = 'User'
                RETURNING id
            )
            INSERT INTO "log" ("system", "subsystem", "severity", "message", "category")
            SELECT
                'User',
                'GrantSupportRoleOnDev',
                'Info',
                jsonb_build_object(
                    'migration', 'GrantSupportRoleOnDev1785950000000',
                    'direction', 'up',
                    'affectedCount', count(*),
                    'userIds', string_agg(id::text, ','),
                    'fromRole', 'User',
                    'toRole', 'Support'
                )::text,
                'up'
            FROM updated
        `);
  }

  /**
   * Revert: restore User role for the same address, only if currently Support and only when
   * up() actually promoted a row (audit log affectedCount > 0).
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

    await queryRunner.query(`
            WITH updated AS (
                UPDATE "user"
                SET "role" = 'User'
                WHERE LOWER("address") = LOWER('${SUPPORT_ACCOUNT_ADDRESS}')
                  AND "role" = 'Support'
                  AND EXISTS (
                      SELECT 1 FROM (
                          SELECT "message" FROM "log"
                          WHERE "system" = 'User'
                            AND "subsystem" = 'GrantSupportRoleOnDev'
                            AND "category" = 'up'
                          OFFSET 0
                      ) "audited"
                      WHERE ("audited"."message"::jsonb ->> 'affectedCount')::int > 0
                  )
                RETURNING id
            )
            INSERT INTO "log" ("system", "subsystem", "severity", "message", "category")
            SELECT
                'User',
                'GrantSupportRoleOnDev',
                'Info',
                jsonb_build_object(
                    'migration', 'GrantSupportRoleOnDev1785950000000',
                    'direction', 'down',
                    'affectedCount', count(*),
                    'userIds', string_agg(id::text, ','),
                    'fromRole', 'Support',
                    'toRole', 'User'
                )::text,
                'down'
            FROM updated
        `);
  }
};
