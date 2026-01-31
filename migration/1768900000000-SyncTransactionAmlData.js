/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Sync transaction AML data for buy_crypto records with mismatched amlCheck status.
 *
 * This fixes two data synchronization issues:
 *
 * 1. bc.amlCheck='Pass' but t.amlCheck=NULL (10 records, ~160k CHF)
 *    Caused by transactions being batched/completed before AML check passed.
 *    Fix: Copy AML data from buy_crypto to transaction.
 *
 * 2. bc.amlCheck='Fail' but t.amlCheck='Pass' (11 records, ~127k CHF)
 *    Caused by AML status changing to Fail after transaction was already updated.
 *    Fix: Reset transaction AML fields to NULL (standard behavior for Fail).
 *
 * Related issue: https://github.com/DFXswiss/api/issues/3086
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

    if (affectedTransactions.length > 0) {
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

      console.log(`Updated ${result?.rowsAffected ?? affectedTransactions.length} transaction records (Pass)`);
    }

    // --- Part 2: Fix transactions where bc.amlCheck='Fail' but t.amlCheck='Pass' ---
    // These had Pass initially, then bc.amlCheck was changed to Fail, but transaction wasn't reset.
    // Standard behavior: when amlCheck is not Pass, transaction AML fields remain NULL.

    const failTransactions = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bc.id AS buyCryptoId,
        bc.amlCheck AS bcAmlCheck,
        bc.amlReason,
        t.amlCheck AS tAmlCheck,
        bc.amountInChf
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      WHERE bc.amlCheck = 'Fail'
        AND t.amlCheck = 'Pass'
    `);

    console.log(`\nFound ${failTransactions.length} transactions with Fail/Pass mismatch to reset:`);
    for (const tx of failTransactions) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}: ` +
          `${tx.amountInChf} CHF, reason=${tx.amlReason}`,
      );
    }

    if (failTransactions.length > 0) {
      const resetResult = await queryRunner.query(`
        UPDATE t
        SET
          t.amlCheck = NULL,
          t.assets = NULL,
          t.highRisk = NULL,
          t.eventDate = NULL,
          t.amlType = NULL,
          t.updated = GETDATE()
        FROM dbo.[transaction] t
        INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
        WHERE bc.amlCheck = 'Fail'
          AND t.amlCheck = 'Pass'
      `);

      console.log(`Reset ${resetResult?.rowsAffected ?? failTransactions.length} transaction records (Fail)`);
    }
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
