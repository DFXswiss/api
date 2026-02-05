/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAuditPeriodSetting1770400000000 {
  name = 'AddAuditPeriodSetting1770400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const auditPeriod = JSON.stringify({ start: '2025-01-30T00:00:00Z', end: '2026-02-02T00:00:00Z' });
    await queryRunner.query(`INSERT INTO "dbo"."setting" ("key", "value") VALUES ('AuditPeriod', '${auditPeriod}')`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "dbo"."setting" WHERE "key" = 'AuditPeriod'`);
  }
};
