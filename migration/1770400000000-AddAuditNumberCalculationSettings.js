/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAuditNumberCalculationSettings1770400000000 {
  name = 'AddAuditNumberCalculationSettings1770400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `INSERT INTO "dbo"."setting" ("key", "value") VALUES ('AuditNumberCalculationStartDate', '2025-01-30T00:00:00Z')`,
    );
    await queryRunner.query(
      `INSERT INTO "dbo"."setting" ("key", "value") VALUES ('AuditNumberCalculationEndDate', '2026-02-02T00:00:00Z')`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "dbo"."setting" WHERE "key" = 'AuditNumberCalculationStartDate'`);
    await queryRunner.query(`DELETE FROM "dbo"."setting" WHERE "key" = 'AuditNumberCalculationEndDate'`);
  }
};
