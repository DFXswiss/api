/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * The concrete Bank Frick account rows are deliberately not part of this migration: their IBANs
 * are deployment secrets and were not supplied for this issue. DFX operations must insert those
 * rows separately before enabling either account polling or the default-off payout rail.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankFrickPayoutTracking1783944000000 {
  name = 'AddBankFrickPayoutTracking1783944000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickOrderId" character varying(255)`);
    await queryRunner.query(`ALTER TABLE "fiat_output" ADD "frickTxId" character varying(255)`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickTxId"`);
    await queryRunner.query(`ALTER TABLE "fiat_output" DROP COLUMN "frickOrderId"`);
  }
};
