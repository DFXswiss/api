/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * DEV-ONLY credential rotation: clears stored user wallet signatures that were produced with the
 * old environment-independent sign message.
 *
 * Before the env-scoped sign-message fix, every environment signed the same historical text. A
 * signature stored on DEV was therefore also valid on PRD — a DEV database read would yield working
 * PRD login credentials. After the fix, non-PRD environments prefix the sign message, so new DEV
 * signatures no longer verify on PRD. Existing DEV rows still hold the old (PRD-valid) signatures
 * and must be discarded.
 *
 * Guarded to `ENVIRONMENT === 'dev'` so loc/prd/CI are no-ops. Returning early still records the
 * migration as executed, which is the intended no-op outside DEV.
 *
 * up():
 *   1. dev guard (no-op elsewhere)
 *   2. audit-then-null via data-modifying CTEs: lock non-null signatures, insert an audit log row
 *      with md5 fingerprints (not plaintext credentials), then null signatures only if the audit
 *      insert succeeded (fail-closed)
 *
 * down() deliberately does NOT restore values: signatures are login credentials and only their
 * md5 fingerprint is retained in the audit log, so the prior value is not reconstructible by
 * design. Always a no-op in every environment (not a guaranteed inverse).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ClearDevUserSignatures1785500000000 {
  name = 'ClearDevUserSignatures1785500000000';

  /**
   * Credential rotation: discard all DEV-stored signatures that were produced with the old,
   * environment-independent sign message and would (before this fix) have authenticated on PRD.
   *
   * Audit trail stores md5("signature") fingerprints rather than plaintext: a candidate value can
   * still be checked against the fingerprint during an investigation, without keeping the login
   * credential in the database. md5 is used here solely as an audit fingerprint — not a security
   * primitive (no password hashing, no salt; pure evidentiary purpose).
   *
   * EXISTS (SELECT 1 FROM "audit") fail-closes the UPDATE to the audit INSERT: if the insert fails,
   * no row is changed (CONTRIBUTING.md "Auditable mutations — no destructive overwrites (CRITICAL)",
   * before→after audit before the update).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    if (process.env.ENVIRONMENT !== 'dev') return;

    await queryRunner.query(`
WITH "affected" AS (
  SELECT "id", md5("signature") AS "fingerprint"
  FROM "user"
  WHERE "signature" IS NOT NULL
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'User', 'DevSignatureRotation', 'Info',
    json_agg(json_build_object(
      'id', "id",
      'beforeFingerprint', "fingerprint",
      'after', null
    ))::text
  FROM "affected"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "user" u
SET "signature" = NULL
FROM "affected" a
WHERE u."id" = a."id" AND EXISTS (SELECT 1 FROM "audit");
`);
  }

  /**
   * Deliberately does not restore signature values: they are login credentials and only their
   * fingerprint remains in the audit log, so the prior value is not reconstructible by design.
   * Always a no-op in every environment — no env gate needed.
   */
  async down() {
    // Deliberately not restoring signature values: they are login credentials and only their
    // md5 fingerprint is retained in the audit log, so the prior value is not reconstructible by
    // design. Not a guaranteed inverse; no-op in every environment.
  }
};
