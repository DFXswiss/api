/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix BankTx type for LIQ_MANAGEMENT transactions incorrectly classified as Internal.
 *
 * LIQ_MANAGEMENT FiatOutput transactions were being set to type 'Internal'
 * instead of their specific types (Scrypt, Kraken, SCB).
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
    // Fix Scrypt transactions
    const scryptResult = await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'Scrypt'
      WHERE "type" = 'Internal'
        AND "name" LIKE '%Scrypt Digital Trading%'
    `);
    console.log(`Fixed BankTx Scrypt type: ${scryptResult?.rowsAffected ?? scryptResult} rows updated`);

    // Fix Kraken transactions
    const krakenResult = await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'Kraken'
      WHERE "type" = 'Internal'
        AND "name" LIKE '%Payward Trading%'
    `);
    console.log(`Fixed BankTx Kraken type: ${krakenResult?.rowsAffected ?? krakenResult} rows updated`);

    // Fix SCB transactions
    const scbResult = await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'SCB'
      WHERE "type" = 'Internal'
        AND "name" LIKE '%SCB AG%'
    `);
    console.log(`Fixed BankTx SCB type: ${scbResult?.rowsAffected ?? scbResult} rows updated`);
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

    await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'Internal'
      WHERE "type" = 'Kraken'
        AND "name" LIKE '%Payward Trading%'
    `);

    await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "type" = 'Internal'
      WHERE "type" = 'SCB'
        AND "name" LIKE '%SCB AG%'
    `);

    console.log('Reverted BankTx types to Internal');
  }
};
