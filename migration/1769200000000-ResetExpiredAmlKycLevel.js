/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset KYC level for users with expired AML and no reactivation.
 *
 * Users with KycLevel >= 30 who have amlListExpiredDate set but no
 * amlListReactivatedDate should not have elevated KYC levels, as their
 * AML verification has expired and was never renewed.
 *
 * This migration sets their KycLevel back to 20 (basic level).
 *
 * Affected users: 359 (as of 2026-01-31)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetExpiredAmlKycLevel1769200000000 {
  name = 'ResetExpiredAmlKycLevel1769200000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // First, log the count of affected users for verification
    const result = await queryRunner.query(`
      SELECT COUNT(*) as count
      FROM "dbo"."user_data"
      WHERE "kycLevel" >= 30
        AND "amlListExpiredDate" IS NOT NULL
        AND "amlListReactivatedDate" IS NULL
    `);
    console.log(`Resetting KYC level for ${result[0].count} users with expired AML and no reactivation`);

    // Update KycLevel to 20 for all affected users
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "kycLevel" = 20
      WHERE "kycLevel" >= 30
        AND "amlListExpiredDate" IS NOT NULL
        AND "amlListReactivatedDate" IS NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Note: This down migration cannot fully restore the original state
    // as we don't know the original KycLevel values. This sets them to 50
    // as a reasonable default for users who had completed KYC.
    console.log('Warning: Down migration sets KycLevel to 50, original values are not preserved');

    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "kycLevel" = 50
      WHERE "kycLevel" = 20
        AND "amlListExpiredDate" IS NOT NULL
        AND "amlListReactivatedDate" IS NULL
        AND "kycStatus" = 'Completed'
    `);
  }
};
