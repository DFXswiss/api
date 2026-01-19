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
    // Get all bank_tx IDs without a transaction
    const bankTxWithoutTransaction = await queryRunner.query(`
      SELECT id FROM dbo.bank_tx WHERE transactionId IS NULL
    `);

    for (const bankTx of bankTxWithoutTransaction) {
      // Generate a unique UID (T + 16 hex chars)
      const uid = 'T' + Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');

      // Create the transaction
      await queryRunner.query(`
        INSERT INTO dbo.[transaction] (uid, sourceType, created, updated)
        VALUES ('${uid}', 'BankTx', GETDATE(), GETDATE())
      `);

      // Get the newly created transaction ID
      const [{ id: transactionId }] = await queryRunner.query(`SELECT SCOPE_IDENTITY() as id`);

      // Link the bank_tx to the transaction
      await queryRunner.query(`
        UPDATE dbo.bank_tx
        SET transactionId = ${transactionId}
        WHERE id = ${bankTx.id}
      `);

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
