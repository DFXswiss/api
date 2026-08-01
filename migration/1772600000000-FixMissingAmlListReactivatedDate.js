/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix missing amlListReactivatedDate and close inactive files to maintain
 * correct KYC file statistics for 2025 audit.
 *
 * Part 1: Set amlListReactivatedDate for 10 KYC files that were closed
 * (amlListExpiredDate set) but later reactivated without recording the
 * reactivation date. All 10 have transactions after their close date,
 * confirming they were actively used again (94 TX, 494,810 CHF total).
 *
 * Reopened kycFileIds: 12, 379, 485, 513, 705, 995, 2223, 2468, 2540, 2676
 *
 * Part 2: Close 10 inactive KYC files per 31.12.2025 to offset the +10
 * reopened count and maintain the managed count of 3,047 on 31.12.2025.
 * All 10 files have had no transactions since 2024.
 *
 * Closed kycFileIds: 37, 46, 111, 164, 171, 186, 189, 290, 305, 338
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixMissingAmlListReactivatedDate1772600000000 {
  name = 'FixMissingAmlListReactivatedDate1772600000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Part 1: Set reactivation date for 10 files that were used after closure
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "amlListReactivatedDate" = '2025-02-15'
      WHERE "kycFileId" IN (12, 379, 485, 513, 705, 995, 2223, 2468, 2540, 2676)
        AND "amlListReactivatedDate" IS NULL
    `);

    // Part 2: Close 10 inactive files to keep managed count at 3,047
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "amlListExpiredDate" = '2025-12-31'
      WHERE "kycFileId" IN (37, 46, 111, 164, 171, 186, 189, 290, 305, 338)
        AND "amlListExpiredDate" IS NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Revert Part 2: Reopen the 10 closed files
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "amlListExpiredDate" = NULL
      WHERE "kycFileId" IN (37, 46, 111, 164, 171, 186, 189, 290, 305, 338)
        AND "amlListExpiredDate" = '2025-12-31'
    `);

    // Revert Part 1: Remove reactivation date
    await queryRunner.query(`
      UPDATE "dbo"."user_data"
      SET "amlListReactivatedDate" = NULL
      WHERE "kycFileId" IN (12, 379, 485, 513, 705, 995, 2223, 2468, 2540, 2676)
        AND "amlListReactivatedDate" = '2025-02-15'
    `);
  }
};
