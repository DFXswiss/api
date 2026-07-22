/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class GeneralizeVibanProviderAccountRef1784600000000 {
  name = 'GeneralizeVibanProviderAccountRef1784600000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "virtual_iban" RENAME COLUMN "yapealAccountUid" TO "providerAccountRef"`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "virtual_iban" RENAME COLUMN "providerAccountRef" TO "yapealAccountUid"`);
  }
};
