/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Create missing transactions for bank_tx records that have no transaction.
 *
 * Some bank_tx records were imported without creating a corresponding transaction,
 * which causes errors when trying to set their type (e.g., BankTxReturn).
 *
 * Affected transactions (as of 2026-01-19):
 * - ID 186224: BankAccountFee
 * - ID 186225: Pending (57399.75 EUR)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class CreateMissingBankTxTransactions1768823084000 {
  name = 'CreateMissingBankTxTransactions1768823084000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const crypto = require('crypto');

    // Get all bank_tx IDs without a transaction
    const bankTxWithoutTransaction = await queryRunner.query(`
      SELECT id FROM dbo.bank_tx WHERE transactionId IS NULL
    `);

    for (const bankTx of bankTxWithoutTransaction) {
      // Generate a cryptographically secure UID (T + 16 hex chars)
      const uid = 'T' + crypto.randomBytes(8).toString('hex').toUpperCase();

      // Create the transaction with OUTPUT clause for atomic ID retrieval
      const result = await queryRunner.query(
        `INSERT INTO dbo.[transaction] (uid, sourceType, created, updated)
         OUTPUT INSERTED.id
         VALUES (@0, 'BankTx', GETDATE(), GETDATE())`,
        [uid],
      );

      const transactionId = result[0].id;

      // Link the bank_tx to the transaction
      await queryRunner.query(
        `UPDATE dbo.bank_tx SET transactionId = @0 WHERE id = @1`,
        [transactionId, bankTx.id],
      );

      console.log(`Created transaction ${transactionId} (${uid}) for bank_tx ${bankTx.id}`);
    }

    console.log(`Created ${bankTxWithoutTransaction.length} missing transactions for bank_tx records`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // This migration cannot be safely reverted without potentially breaking data integrity
    console.log('Down migration not implemented - manual intervention required if needed');
  }
};
