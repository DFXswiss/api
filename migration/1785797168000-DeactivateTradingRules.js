/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PRD-ONLY operational shutdown: deactivates three trading rules (ids 2, 7 and 11) that must stop
 * trading in production. These ids are production identities — on dev/loc/CI they either do not
 * exist or refer to unrelated rows, so this migration is guarded to run only where the ids are
 * meaningful.
 *
 * Guarded to `ENVIRONMENT === 'prd'` so dev/loc/CI are no-ops. Returning early still records the
 * migration as executed, which is the intended no-op outside PRD (same pattern as
 * LinkOndoPriceRule).
 *
 * up():
 *   1. prd guard (no-op elsewhere)
 *   2. audit-then-update via data-modifying CTEs: lock the three rules, insert an audit log row
 *      with the before/after status for every affected row, then update status to 'Inactive' only
 *      if the audit insert succeeded (fail-closed)
 *
 * The filter is `"status" != 'Inactive'` rather than `"status" = 'Active'` on purpose: it also
 * catches rules that happen to be `Processing` or `Paused` at deploy time, and it makes the
 * migration idempotent — rerunning it after a rule was already deactivated finds an empty
 * "affected" set, so the audit HAVING clause suppresses the insert and the UPDATE changes nothing.
 *
 * down() is not an exact inverse: a rule that was `Processing` or `Paused` before up() ran comes
 * back as `Active`, not its original status — that is the correct operational default state. The
 * exact prior status of every affected row remains available in the up() audit log line.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class DeactivateTradingRules1785797168000 {
  name = 'DeactivateTradingRules1785797168000';

  /**
   * Deactivates trading rules 2, 7 and 11 by setting their status to 'Inactive'.
   *
   * EXISTS (SELECT 1 FROM "audit") fail-closes the UPDATE to the audit INSERT: if the insert fails,
   * no row is changed (CONTRIBUTING.md "Auditable mutations — no destructive overwrites (CRITICAL)",
   * before→after audit before the update).
   *
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Operational shutdown migration: the rule ids are PRD identities and NEVER run on dev/loc/CI,
    // where these ids either do not exist or refer to unrelated rows. Returning early still records
    // the migration as executed, the intended no-op on lower environments (same rationale as
    // LinkOndoPriceRule).
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`
WITH "affected" AS (
  SELECT "id", "status" FROM "trading_rule"
  WHERE "id" IN (2, 7, 11) AND "status" != 'Inactive'
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'Migration', 'DeactivateTradingRules1785797168000', 'Info',
    json_agg(json_build_object('id', "id", 'before', "status", 'after', 'Inactive'))::text
  FROM "affected"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "trading_rule" r
SET "status" = 'Inactive', "updated" = now()
FROM "affected" a
WHERE r."id" = a."id" AND EXISTS (SELECT 1 FROM "audit");
`);
  }

  /**
   * Reactivates trading rules 2, 7 and 11 by setting their status back to 'Active'. Not a
   * guaranteed inverse of up(): a rule that was `Processing` or `Paused` before up() ran comes back
   * as `Active` rather than its original status. See the class doc comment for details; the exact
   * prior status remains available in the up() audit log line.
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Mirror up(): the deactivation only ran on prd, so the rollback is a no-op everywhere else.
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`
WITH "affected" AS (
  SELECT "id", "status" FROM "trading_rule"
  WHERE "id" IN (2, 7, 11) AND "status" = 'Inactive'
  FOR UPDATE
),
"audit" AS (
  INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
  SELECT now(), now(), 'Migration', 'DeactivateTradingRules1785797168000', 'Info',
    json_agg(json_build_object('id', "id", 'before', "status", 'after', 'Active'))::text
  FROM "affected"
  HAVING count(*) > 0
  RETURNING 1
)
UPDATE "trading_rule" r
SET "status" = 'Active', "updated" = now()
FROM "affected" a
WHERE r."id" = a."id" AND EXISTS (SELECT 1 FROM "audit");
`);
  }
};
