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

// The Compliance account is targeted through its wallet address and resolved to a user-data id in SQL:
// the account's id cannot be looked up beforehand, because every tool that could answer that question
// sits behind the very clearance gate this migration repairs. A wallet address is pseudonymous and
// already public on-chain, so it may appear here (precedent: the GSheet service account in
// 1785584840000-BackfillStaffVerifiedNames). Matching is case-insensitive on purpose — the address was
// transcribed from the app, which renders the EIP-55 checksummed form, and a casing difference against
// the stored value must not decide a boot-fatal assertion.
const COMPLIANCE_ACCOUNT_ADDRESS = '0xBB922dB5F637aAfdc54b1509b231cc07461fb608';
const DEBUG_ACCOUNT_ID = 395822;

/**
 * PRD-only backfill for two staff accounts of the same staff member that the staff-clearance rule
 * (#4395 → #4572) gated out: a Compliance account (resolved via its wallet address) and a Debug
 * account (user data 395822). The earlier backfills (#4574, #4590) covered other accounts; these two
 * still fail every elevated endpoint with STAFF_KYC_REQUIRED — the entire Compliance tool and
 * POST /gs/debug included. Self-service KYC cannot repair them: the KYC flow rejects Compliance-role
 * accounts outright (#3577).
 *
 * Both rows receive the same identity — one person, one reviewed name — read from the single
 * deployment variable STAFF_VERIFIED_NAME_395822, keyed by the one account id that is known at review
 * time. No plaintext personal name lives in this file; the variable is mandatory on PRD so TypeORM
 * cannot record a partial/no-op migration when it is missing. The update is idempotent (only touches
 * null-or-blank verifiedName values) and coupled to a durable before/after audit entry. Guarded to
 * prd; a no-op elsewhere.
 *
 * The closing assertion checks the clearance predicate itself, per account, rather than equality with
 * the supplied name: should an identity-verified path have written a different (correct) name in the
 * meantime, that account is cleared and the migration must not fail the deploy over the spelling.
 * That divergence is not silent — it is recorded as its own audit entry, so the deployed state never
 * differs from the reviewed one without a trace.
 * @class @implements {MigrationInterface}
 */
module.exports = class BackfillComplianceAndDebugStaffVerifiedNames1785742000000 {
  name = 'BackfillComplianceAndDebugStaffVerifiedNames1785742000000';

  async up(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    const verifiedName = process.env.STAFF_VERIFIED_NAME_395822?.trim();
    if (!verifiedName) throw new Error('STAFF_VERIFIED_NAME_395822 is required for the PRD staff-name backfill');

    // `needsBackfill` is the exact negation of the closing assertion below. The two must stay
    // complementary: a precondition of `verifiedName IS NULL` against a non-blank postcondition would
    // leave a present-but-blank name (a lone tab, a non-breaking space) as a state the migration
    // refuses to repair and then refuses to accept — and because `migrationsTransactionMode` defaults
    // to 'all', that throw rolls back the whole release's batch and takes the boot down with it.
    //
    // `noteworthy` is what gets audited: the repair itself, or the deliberate decision to keep a
    // divergent name that an identity-verified path wrote in the meantime. A re-run after a successful
    // backfill is neither, so it stays a true no-op instead of appending an audit row every time.
    // Array.of avoids looking like MSSQL bracket quoting to the repository's migration syntax guard.
    await queryRunner.query(
      `WITH "targets" AS (
         SELECT "id",
                "verifiedName" AS "previousVerifiedName",
                BTRIM(COALESCE("verifiedName", ''), $2::varchar) = '' AS "needsBackfill"
         FROM "user_data"
         WHERE "id" = ${DEBUG_ACCOUNT_ID}
            OR "id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($3::varchar))
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
      Array.of(verifiedName, BLANK_CHARS, COMPLIANCE_ACCOUNT_ADDRESS),
    );

    const rows = await queryRunner.query(
      `SELECT
         (SELECT count(*)::int FROM "user_data"
          WHERE "id" = ${DEBUG_ACCOUNT_ID} AND BTRIM("verifiedName", $1::varchar) <> '') AS "debugCleared",
         (SELECT count(*)::int FROM "user_data" ud
          WHERE ud."id" IN (SELECT "userDataId" FROM "user" WHERE LOWER("address") = LOWER($2::varchar))
            AND BTRIM(ud."verifiedName", $1::varchar) <> '') AS "complianceCleared"`,
      Array.of(BLANK_CHARS, COMPLIANCE_ACCOUNT_ADDRESS),
    );

    if (Number(rows.at(0)?.debugCleared) !== 1 || Number(rows.at(0)?.complianceCleared) !== 1) {
      throw new Error('PRD staff-name backfill did not reach the required state for both staff accounts');
    }
  }

  async down() {
    // No-op: a granted clearance is not auto-revoked here; removal requires a separate reviewed,
    // audited revocation so an unrelated rollback cannot silently erase an identity grant.
  }
};
