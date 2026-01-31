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
    // First, check for any affected transactions with incomplete source data
    const incompleteData = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bc.id AS buyCryptoId,
        bc.inputReferenceAsset,
        bc.outputAssetId
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      WHERE bc.amlCheck = 'Pass'
        AND t.amlCheck IS NULL
        AND (bc.inputReferenceAsset IS NULL OR bc.outputAssetId IS NULL)
    `);

    if (incompleteData.length > 0) {
      console.log(`WARNING: Found ${incompleteData.length} transactions with incomplete source data:`);
      for (const tx of incompleteData) {
        console.log(
          `  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}: ` +
            `inputReferenceAsset=${tx.inputReferenceAsset}, outputAssetId=${tx.outputAssetId}`,
        );
      }
      console.log('These transactions will be SKIPPED.');
    }

    // Find all transactions that can be fixed (complete source data)
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
        AND bc.inputReferenceAsset IS NOT NULL
    `);

    console.log(`Found ${affectedTransactions.length} transactions to fix:`);
    for (const tx of affectedTransactions) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}: ` +
          `${tx.amountInChf} CHF, assets=${tx.inputReferenceAsset}-${tx.outputAssetName}`,
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
        AND bc.inputReferenceAsset IS NOT NULL
    `);

    console.log(`Updated ${result?.rowsAffected ?? affectedTransactions.length} transaction records`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // This migration fixes data that was incorrectly left unsynchronized due to a bug.
    // Rolling back would return the data to an incorrect state.
    // If a rollback is truly needed, the affected transaction IDs should be identified
    // from the migration logs and handled manually.
    console.log(
      'Down migration is a no-op. Rolling back would return data to an incorrect state. ' +
        'If needed, identify affected transactions from migration logs and handle manually.',
    );
  }
};
