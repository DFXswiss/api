/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Sync transaction AML data for buy_crypto records where transaction.amlCheck is NULL
 * but buy_crypto.amlCheck is 'Pass'.
 *
 * This fixes a data synchronization issue caused by a bug in buy-crypto-batch.service.ts
 * where transactions could be batched and completed before their AML check passed.
 * When the AML check was later set to Pass, the postProcessing method was not called
 * because the transaction was already marked as complete.
 *
 * Related issue: https://github.com/DFXswiss/api/issues/3086
 *
 * Affected columns:
 * - amlCheck: Set to 'Pass'
 * - assets: Set to inputReferenceAsset + '-' + outputAsset.name
 * - amountInChf: Copy from buy_crypto.amountInChf
 * - highRisk: Copy from buy_crypto.highRisk (default 0)
 * - eventDate: Set to buy_crypto.created
 * - amlType: Copy from transaction.type
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class SyncTransactionAmlData1768900000000 {
  name = 'SyncTransactionAmlData1768900000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // First, log which transactions will be affected
    const affectedTransactions = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bc.id AS buyCryptoId,
        bc.amlCheck,
        bc.inputReferenceAsset,
        a.name AS outputAssetName,
        bc.amountInChf,
        bc.highRisk,
        bc.created
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      INNER JOIN dbo.asset a ON bc.outputAssetId = a.id
      WHERE bc.amlCheck = 'Pass'
        AND t.amlCheck IS NULL
    `);

    console.log(`Found ${affectedTransactions.length} transactions to fix:`);
    for (const tx of affectedTransactions) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}: ${tx.amountInChf} CHF`,
      );
    }

    if (affectedTransactions.length === 0) {
      console.log('No transactions need to be fixed.');
      return;
    }

    // Update the transaction records with the missing AML data
    const result = await queryRunner.query(`
      UPDATE t
      SET
        t.amlCheck = 'Pass',
        t.assets = bc.inputReferenceAsset + '-' + a.name,
        t.amountInChf = bc.amountInChf,
        t.highRisk = COALESCE(bc.highRisk, 0),
        t.eventDate = bc.created,
        t.amlType = t.type,
        t.updated = GETDATE()
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      INNER JOIN dbo.asset a ON bc.outputAssetId = a.id
      WHERE bc.amlCheck = 'Pass'
        AND t.amlCheck IS NULL
    `);

    console.log(`Updated ${result?.rowsAffected ?? affectedTransactions.length} transaction records`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Reset the synchronized fields to NULL for affected transactions
    // Note: This will only revert transactions that were fixed by this migration
    // (where buy_crypto.amlCheck = 'Pass' and the transaction fields match)
    const result = await queryRunner.query(`
      UPDATE t
      SET
        t.amlCheck = NULL,
        t.assets = NULL,
        t.amountInChf = NULL,
        t.highRisk = NULL,
        t.eventDate = NULL,
        t.amlType = NULL,
        t.updated = GETDATE()
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      INNER JOIN dbo.asset a ON bc.outputAssetId = a.id
      WHERE bc.amlCheck = 'Pass'
        AND t.amlCheck = 'Pass'
        AND t.assets = bc.inputReferenceAsset + '-' + a.name
        AND t.amountInChf = bc.amountInChf
    `);

    console.log(`Reverted ${result?.rowsAffected ?? 0} transaction records`);
  }
};
