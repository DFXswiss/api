/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMrosReportFields1776957972101 {
  name = 'AddMrosReportFields1776957972101';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `ALTER TABLE "mros" ADD "reportCode" nvarchar(256) NOT NULL CONSTRAINT "DF_mros_reportCode" DEFAULT 'SAR'`,
    );
    await queryRunner.query(`ALTER TABLE "mros" ADD "reason" nvarchar(MAX)`);
    await queryRunner.query(`ALTER TABLE "mros" ADD "action" nvarchar(MAX)`);
    await queryRunner.query(`ALTER TABLE "mros" ADD "indicators" nvarchar(MAX)`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "indicators"`);
    await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "action"`);
    await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "reason"`);
    await queryRunner.query(`ALTER TABLE "mros" DROP CONSTRAINT "DF_mros_reportCode"`);
    await queryRunner.query(`ALTER TABLE "mros" DROP COLUMN "reportCode"`);
  }
};
