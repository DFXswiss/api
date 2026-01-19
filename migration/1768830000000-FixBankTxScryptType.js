/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix BankTx type for Scrypt transactions incorrectly classified as Internal.
 *
 * LIQ_MANAGEMENT FiatOutput transactions to Scrypt Digital Trading AG were
 * being set to type 'Internal' instead of 'Scrypt'.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixBankTxScryptType1768830000000 {
  name = 'FixBankTxScryptType1768830000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const result = await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'Scrypt'
      WHERE "type" = 'Internal'
        AND "name" LIKE '%Scrypt Digital Trading%'
    `);

    console.log(`Fixed BankTx Scrypt type: ${result?.rowsAffected ?? result} rows updated`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'Internal'
      WHERE "type" = 'Scrypt'
        AND "name" LIKE '%Scrypt Digital Trading%'
    `);

    console.log('Reverted BankTx Scrypt type to Internal');
  }
};
