/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `user_data.scorechainCheckDate`: the date compliance reviewed and released this account's
 * Scorechain findings. Nullable and null for every existing row, so nothing is exempted by the
 * migration itself — the state only changes where compliance sets a date.
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddUserDataScorechainCheckDate1785830000000 {
  name = 'AddUserDataScorechainCheckDate1785830000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user_data" ADD "scorechainCheckDate" TIMESTAMP`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "scorechainCheckDate"`);
  }
};
