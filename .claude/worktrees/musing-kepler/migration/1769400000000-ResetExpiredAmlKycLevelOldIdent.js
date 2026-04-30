/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset KYC level for users with Ident renewal before 2026.
 *
 * These 27 users have:
 * - amlListExpiredDate set (AML expired)
 * - amlListReactivatedDate NULL
 * - DfxApproval completed AFTER expiry
 * - Ident completed AFTER expiry but BEFORE 2026
 *
 * Their Ident verification is outdated (2024 or 2025).
 * KycLevel should be reset to 20 until they complete a fresh Ident in 2026.
 *
 * Affected users: 27 (as of 2026-01-31)
 * Excluded: 3 users with Ident in 2026 (1787, 3864, 9087)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetExpiredAmlKycLevelOldIdent1769400000000 {
  name = 'ResetExpiredAmlKycLevelOldIdent1769400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // First, log the affected users for verification
    const users = await queryRunner.query(`
      SELECT ud."id", ud."kycLevel",
        (SELECT MIN(ks2."created") FROM "dbo"."kyc_step" ks2
         WHERE ks2."userDataId" = ud."id"
           AND ks2."name" = 'Ident'
           AND ks2."status" = 'Completed'
           AND ks2."created" > ud."amlListExpiredDate") as identDate
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
                    AND ks3."created" > ud."amlListExpiredDate")) < 2026
    `);

    console.log(`Found ${users.length} users with Ident before 2026:`);
    for (const user of users) {
      console.log(`  - UserData ${user.id}: kycLevel ${user.kycLevel} -> 20, Ident: ${user.identDate}`);
    }

    // Update KycLevel to 20 for affected users
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "kycLevel" = 20
      WHERE "kycLevel" >= 30
        AND "amlListExpiredDate" IS NOT NULL
        AND "amlListReactivatedDate" IS NULL
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step" ks
          WHERE ks."userDataId" = "user_data"."id"
            AND ks."name" = 'DfxApproval'
            AND ks."status" = 'Completed'
            AND ks."created" > "user_data"."amlListExpiredDate"
        )
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step" ks2
          WHERE ks2."userDataId" = "user_data"."id"
            AND ks2."name" = 'Ident'
            AND ks2."status" = 'Completed'
            AND ks2."created" > "user_data"."amlListExpiredDate"
        )
        AND YEAR((SELECT MIN(ks3."created") FROM "dbo"."kyc_step" ks3
                  WHERE ks3."userDataId" = "user_data"."id"
                    AND ks3."name" = 'Ident'
                    AND ks3."status" = 'Completed'
                    AND ks3."created" > "user_data"."amlListExpiredDate")) < 2026
    `);

    console.log(`Reset KycLevel to 20 for ${users.length} users`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    console.log('Down migration is a no-op - original KycLevel values are not preserved');
  }
};
