/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixUserDataWalletId4058961783665552946 {
  name = 'FixUserDataWalletId4058961783665552946';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`UPDATE "user_data" SET "walletId" = 25 WHERE "id" = 405896 AND "walletId" = 1`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`UPDATE "user_data" SET "walletId" = 1 WHERE "id" = 405896 AND "walletId" = 25`);
  }
};
