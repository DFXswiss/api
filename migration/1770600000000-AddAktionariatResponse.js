/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAktionariatResponse1770600000000 {
  name = 'AddAktionariatResponse1770600000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "aktionariatResponse" nvarchar(MAX)`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "aktionariatResponse"`);
  }
};
