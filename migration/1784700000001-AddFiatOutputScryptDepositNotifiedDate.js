/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `fiat_output.scryptDepositNotifiedDate` for the Scrypt deposit notify sweep.
 * Existing completed LiqManagement payouts to Scrypt are backfilled so the sweep does
 * not re-send historical deposits; the fixed timestamp is an audit marker only
 * (treated as done because the sweep starts here — not proven notified at the broker).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFiatOutputScryptDepositNotifiedDate1784700000001 {
  name = 'AddFiatOutputScryptDepositNotifiedDate1784700000001';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "scryptDepositNotifiedDate" TIMESTAMP`);
    // Audit marker only: treated as done because the sweep starts now — not proven notified at the broker.
    await queryRunner.query(`
      UPDATE "fiat_output"
      SET "scryptDepositNotifiedDate" = TIMESTAMP '2026-07-23 12:00:00'
      WHERE "isComplete" = true
        AND "type" = 'LiqManagement'
        AND "name" LIKE '%Scrypt Digital Trading%'
        AND "scryptDepositNotifiedDate" IS NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "scryptDepositNotifiedDate"`);
  }
};
