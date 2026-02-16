/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Set amlListReactivatedDate for users who properly re-verified in 2026.
 *
 * These 3 users have:
 * - amlListExpiredDate set (AML expired)
 * - amlListReactivatedDate NULL (bug - should have been set)
 * - DfxApproval completed AFTER expiry
 * - Ident completed AFTER expiry IN 2026
 *
 * They are legitimately reactivated but amlListReactivatedDate was not set.
 * This migration sets it to the DfxApproval date.
 *
 * Affected users: 3 (1787, 3864, 9087)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SetAmlReactivatedDate1769500000000 {
  name = 'SetAmlReactivatedDate1769500000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // First, log the affected users for verification
    const users = await queryRunner.query(`
      SELECT ud."id",
        (SELECT MIN(ks."created") FROM "dbo"."kyc_step" ks
         WHERE ks."userDataId" = ud."id"
           AND ks."name" = 'DfxApproval'
           AND ks."status" = 'Completed'
           AND ks."created" > ud."amlListExpiredDate") as dfxApprovalDate
      FROM "dbo"."user_data" ud
      WHERE ud."kycLevel" >= 30
        AND ud."amlListExpiredDate" IS NOT NULL
        AND ud."amlListReactivatedDate" IS NULL
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step" ks
          WHERE ks."userDataId" = ud."id"
            AND ks."name" = 'DfxApproval'
            AND ks."status" = 'Completed'
            AND ks."created" > ud."amlListExpiredDate"
        )
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step" ks2
          WHERE ks2."userDataId" = ud."id"
            AND ks2."name" = 'Ident'
            AND ks2."status" = 'Completed'
            AND ks2."created" > ud."amlListExpiredDate"
        )
        AND YEAR((SELECT MIN(ks3."created") FROM "dbo"."kyc_step" ks3
                  WHERE ks3."userDataId" = ud."id"
                    AND ks3."name" = 'Ident'
                    AND ks3."status" = 'Completed'
                    AND ks3."created" > ud."amlListExpiredDate")) = 2026
    `);

    console.log(`Found ${users.length} users with Ident in 2026 to set amlListReactivatedDate:`);
    for (const user of users) {
      console.log(`  - UserData ${user.id}: amlListReactivatedDate -> ${user.dfxApprovalDate}`);
    }

    // Update amlListReactivatedDate to DfxApproval date for affected users
    await queryRunner.query(`
      UPDATE ud
      SET ud."amlListReactivatedDate" = CAST(ks_approval."created" AS DATE)
      FROM "dbo"."user_data" ud
      CROSS APPLY (
        SELECT MIN(ks."created") as "created"
        FROM "dbo"."kyc_step" ks
        WHERE ks."userDataId" = ud."id"
          AND ks."name" = 'DfxApproval'
          AND ks."status" = 'Completed'
          AND ks."created" > ud."amlListExpiredDate"
      ) ks_approval
      WHERE ud."kycLevel" >= 30
        AND ud."amlListExpiredDate" IS NOT NULL
        AND ud."amlListReactivatedDate" IS NULL
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step" ks
          WHERE ks."userDataId" = ud."id"
            AND ks."name" = 'DfxApproval'
            AND ks."status" = 'Completed'
            AND ks."created" > ud."amlListExpiredDate"
        )
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step" ks2
          WHERE ks2."userDataId" = ud."id"
            AND ks2."name" = 'Ident'
            AND ks2."status" = 'Completed'
            AND ks2."created" > ud."amlListExpiredDate"
        )
        AND YEAR((SELECT MIN(ks3."created") FROM "dbo"."kyc_step" ks3
                  WHERE ks3."userDataId" = ud."id"
                    AND ks3."name" = 'Ident'
                    AND ks3."status" = 'Completed'
                    AND ks3."created" > ud."amlListExpiredDate")) = 2026
    `);

    console.log(`Set amlListReactivatedDate for ${users.length} users`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Reset amlListReactivatedDate to NULL for the 3 users
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "amlListReactivatedDate" = NULL
      WHERE "id" IN (1787, 3864, 9087)
    `);

    console.log('Reset amlListReactivatedDate to NULL for users 1787, 3864, 9087');
  }
};
