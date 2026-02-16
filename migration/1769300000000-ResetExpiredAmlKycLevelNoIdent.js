/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset KYC level for users with DfxApproval after expiry but NO Ident renewal.
 *
 * These 13 users have:
 * - amlListExpiredDate set (AML expired)
 * - amlListReactivatedDate NULL
 * - DfxApproval completed AFTER expiry
 * - But NO Ident completed after expiry (last Ident from 2023-12-01)
 *
 * They received DfxApproval without re-verifying their identity, which is incorrect.
 * Their KycLevel should be reset to 20 until they complete proper re-verification.
 *
 * Affected users: 13 (as of 2026-01-31)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetExpiredAmlKycLevelNoIdent1769300000000 {
  name = 'ResetExpiredAmlKycLevelNoIdent1769300000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // First, log the affected users for verification
    const users = await queryRunner.query(`
      SELECT "id", "kycLevel"
      FROM "dbo"."user_data"
      WHERE "kycLevel" >= 30
        AND "amlListExpiredDate" IS NOT NULL
        AND "amlListReactivatedDate" IS NULL
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step"
          WHERE "userDataId" = "user_data"."id"
            AND "name" = 'DfxApproval'
            AND "status" = 'Completed'
            AND "created" > "user_data"."amlListExpiredDate"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "dbo"."kyc_step"
          WHERE "userDataId" = "user_data"."id"
            AND "name" = 'Ident'
            AND "status" = 'Completed'
            AND "created" > "user_data"."amlListExpiredDate"
        )
    `);

    console.log(`Found ${users.length} users with DfxApproval but no Ident after expiry:`);
    for (const user of users) {
      console.log(`  - UserData ${user.id}: kycLevel ${user.kycLevel} -> 20`);
    }

    // Update KycLevel to 20 for affected users
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "kycLevel" = 20
      WHERE "kycLevel" >= 30
        AND "amlListExpiredDate" IS NOT NULL
        AND "amlListReactivatedDate" IS NULL
        AND EXISTS (
          SELECT 1 FROM "dbo"."kyc_step"
          WHERE "userDataId" = "user_data"."id"
            AND "name" = 'DfxApproval'
            AND "status" = 'Completed'
            AND "created" > "user_data"."amlListExpiredDate"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "dbo"."kyc_step"
          WHERE "userDataId" = "user_data"."id"
            AND "name" = 'Ident'
            AND "status" = 'Completed'
            AND "created" > "user_data"."amlListExpiredDate"
        )
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
