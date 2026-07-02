/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddTotpLockout1782990500000 {
  name = 'AddTotpLockout1782990500000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user_data" ADD "totpFailedAttempts" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "user_data" ADD "totpBlockedUntil" TIMESTAMP`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "totpBlockedUntil"`);
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "totpFailedAttempts"`);
  }
};
