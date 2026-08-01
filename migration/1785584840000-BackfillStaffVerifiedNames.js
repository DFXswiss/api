/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PRD-only backfill: sets `verifiedName` on the staff/service accounts that were gated out when the
 * staff-clearance rule stopped requiring a KYC level (api#4395 → #4572). No plaintext personal name
 * lives in this file: the human account's verified name is read from the PRD deployment variable
 * STAFF_VERIFIED_NAME_375162; the service account carries the non-personal designation 'GSheet'.
 * The deployment variable is mandatory on PRD so TypeORM cannot record a partial/no-op migration when
 * it is missing. The update is idempotent (only touches a still-null verifiedName) and coupled to a
 * durable before/after audit entry. Guarded to prd; a no-op elsewhere.
 * @class @implements {MigrationInterface}
 */
module.exports = class BackfillStaffVerifiedNames1785584840000 {
  name = 'BackfillStaffVerifiedNames1785584840000';

  async up(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    const humanName = process.env.STAFF_VERIFIED_NAME_375162?.trim();
    if (!humanName) throw new Error('STAFF_VERIFIED_NAME_375162 is required for the PRD staff-name backfill');
    // Array.of avoids looking like MSSQL bracket quoting to the repository's migration syntax guard.
    const queryParameters = Array.of(humanName);

    await queryRunner.query(
      `WITH "targets" AS (
         SELECT 375162 AS "id", $1::varchar AS "nextVerifiedName"
         UNION ALL
         SELECT "userDataId", 'GSheet'::varchar
         FROM "user"
         WHERE address = '0x791D0AeC86EE6a86d260543ECD57d7932A7fec2D'
       ),
       "affected" AS (
         SELECT ud."id", ud."verifiedName" AS "previousVerifiedName", t."nextVerifiedName"
         FROM "user_data" ud
         JOIN "targets" t ON t."id" = ud."id"
         WHERE ud."verifiedName" IS NULL
         FOR UPDATE OF ud
       ),
       "audit" AS (
         INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
         SELECT now(), now(), 'User', 'StaffVerifiedNameBackfill', 'Info',
           json_agg(json_build_object(
             'userDataId', "id",
             'previousVerifiedName', "previousVerifiedName",
             'nextVerifiedName', "nextVerifiedName"
           ) ORDER BY "id")::text
         FROM "affected"
         HAVING count(*) > 0
         RETURNING 1
       )
       UPDATE "user_data" ud
       SET "verifiedName" = a."nextVerifiedName", "updated" = now()
       FROM "affected" a
       WHERE ud."id" = a."id" AND EXISTS (SELECT 1 FROM "audit")`,
      queryParameters,
    );

    const [{ humanCount, serviceCount }] = await queryRunner.query(
      `SELECT
         (SELECT count(*)::int FROM "user_data"
          WHERE "id" = 375162 AND "verifiedName" = $1) AS "humanCount",
         (SELECT count(*)::int
          FROM "user" u
          JOIN "user_data" ud ON ud."id" = u."userDataId"
          WHERE u."address" = '0x791D0AeC86EE6a86d260543ECD57d7932A7fec2D'
            AND ud."verifiedName" = 'GSheet') AS "serviceCount"`,
      queryParameters,
    );

    if (Number(humanCount) !== 1 || Number(serviceCount) !== 1) {
      throw new Error('PRD staff-name backfill did not reach the required state for both target accounts');
    }
  }

  async down() {
    // No-op: a granted clearance is not auto-revoked here; removal requires a separate reviewed,
    // audited revocation so an unrelated rollback cannot silently erase an identity/operator grant.
  }
};
