/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PRD-only backfill: sets `verifiedName` on the staff/service accounts that were gated out when the
 * staff-clearance rule stopped requiring a KYC level (api#4395 → #4572). No plaintext personal name
 * lives in this file: the human account's verified name is read from the deployment secret
 * STAFF_VERIFIED_NAME_375162; the service account carries the non-personal designation 'GSheet'.
 * Both UPDATEs are idempotent (only touch a still-null verifiedName). Guarded to prd; a no-op elsewhere.
 * @class @implements {MigrationInterface}
 */
module.exports = class BackfillStaffVerifiedNames1785584840000 {
  name = 'BackfillStaffVerifiedNames1785584840000';

  async up(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    const humanName = process.env.STAFF_VERIFIED_NAME_375162;
    if (humanName && humanName.trim()) {
      await queryRunner.query(`UPDATE user_data SET "verifiedName" = $1 WHERE id = 375162 AND "verifiedName" IS NULL`, [
        humanName.trim(),
      ]);
    }

    await queryRunner.query(
      `UPDATE user_data SET "verifiedName" = 'GSheet'
       WHERE id = (SELECT "userDataId" FROM "user"
                   WHERE address = '0x791D0AeC86EE6a86d260543ECD57d7932A7fec2D')
         AND "verifiedName" IS NULL`,
    );
  }

  async down() {
    // No-op: a granted clearance is not auto-revoked here; removal is a deliberate manual action.
  }
};
