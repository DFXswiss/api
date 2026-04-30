/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix valueDate for 2 bank transactions that have incorrect valueDate.
 *
 * These transactions have bookingDate 2025-01-03 but valueDate 2024-12-31,
 * causing them to be excluded from exports filtered by date range.
 *
 * Affected transactions:
 * - ID 142397: 233.11 EUR (ZV20241231/791326/1)
 * - ID 142392: 39.79 EUR (ZV20241231/791337/1)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixBankTxValueDate1768820385000 {
  name = 'FixBankTxValueDate1768820385000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "valueDate" = '2025-01-03T00:00:00.000Z'
      WHERE "id" IN (142397, 142392)
    `);

    console.log('Fixed valueDate for transactions 142397, 142392');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "valueDate" = '2024-12-31T00:00:00.000Z'
      WHERE "id" IN (142397, 142392)
    `);

    console.log('Reverted valueDate for transactions 142397, 142392');
  }
};
