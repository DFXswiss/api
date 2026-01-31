/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Sync transaction AML data for buy_crypto and buy_fiat records with mismatched amlCheck status.
 *
 * This migration fixes two types of data synchronization issues:
 *
 * 1. BUG FIX (Parts 1-2): Transactions completed before AML check passed.
 *    When the AML check was later set to Pass, postProcessing was not called
 *    because isComplete was already true.
 *    - BuyCrypto: 13 records, ~162k CHF (amlCheck='Pass' but t.amlCheck is NULL or 'Fail')
 *    - BuyFiat: 1 record, ~371 CHF (amlCheck='Pass' but t.amlCheck is NULL)
 *
 * 2. HISTORICAL CLEANUP (Parts 3-4): Chargebacks and blocks that set amlCheck to 'Fail'
 *    after the transaction was already marked as Pass in the transaction table.
 *    - BuyCrypto: 25 records, ~150k CHF (amlCheck='Fail' but t.amlCheck='Pass')
 *    - BuyFiat: 7 records, ~201k CHF (amlCheck='Fail' but t.amlCheck='Pass')
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
    // =====================================================================
    // PART 1: Fix BuyCrypto transactions (outputAsset -> asset table)
    // Fixes cases where bc.amlCheck='Pass' but t.amlCheck is NULL or different
    // =====================================================================
    console.log('=== PART 1: BuyCrypto ===\n');

    // Check for incomplete source data
    const incompleteBuyCrypto = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bc.id AS buyCryptoId,
        bc.inputReferenceAsset,
        bc.outputAssetId
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      WHERE bc.amlCheck = 'Pass'
        AND (t.amlCheck IS NULL OR t.amlCheck <> 'Pass')
        AND (bc.inputReferenceAsset IS NULL OR bc.outputAssetId IS NULL)
    `);

    if (incompleteBuyCrypto.length > 0) {
      console.log(`WARNING: Found ${incompleteBuyCrypto.length} BuyCrypto with incomplete source data (SKIPPED):`);
      for (const tx of incompleteBuyCrypto) {
        console.log(`  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}`);
      }
    }

    // Find BuyCrypto transactions to fix (where bc.amlCheck='Pass' but t.amlCheck is not 'Pass')
    const buyCryptoToFix = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bc.id AS buyCryptoId,
        t.amlCheck AS currentTxAmlCheck,
        bc.inputReferenceAsset,
        a.name AS outputAssetName,
        bc.amountInChf
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      INNER JOIN dbo.asset a ON bc.outputAssetId = a.id
      WHERE bc.amlCheck = 'Pass'
        AND (t.amlCheck IS NULL OR t.amlCheck <> 'Pass')
        AND bc.inputReferenceAsset IS NOT NULL
    `);

    console.log(`Found ${buyCryptoToFix.length} BuyCrypto transactions to fix:`);
    for (const tx of buyCryptoToFix) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}: ` +
          `${tx.amountInChf} CHF, assets=${tx.inputReferenceAsset}-${tx.outputAssetName}, ` +
          `current t.amlCheck=${tx.currentTxAmlCheck}`,
      );
    }

    if (buyCryptoToFix.length > 0) {
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
          AND (t.amlCheck IS NULL OR t.amlCheck <> 'Pass')
          AND bc.inputReferenceAsset IS NOT NULL
      `);
      console.log(`Updated ${result?.rowsAffected ?? buyCryptoToFix.length} BuyCrypto transaction records\n`);
    }

    // =====================================================================
    // PART 2: Fix BuyFiat transactions (outputAsset -> fiat table)
    // Fixes cases where bf.amlCheck='Pass' but t.amlCheck is NULL or different
    // =====================================================================
    console.log('=== PART 2: BuyFiat ===\n');

    // Check for incomplete source data
    const incompleteBuyFiat = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bf.id AS buyFiatId,
        bf.inputReferenceAsset,
        bf.outputAssetId
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_fiat bf ON bf.transactionId = t.id
      WHERE bf.amlCheck = 'Pass'
        AND (t.amlCheck IS NULL OR t.amlCheck <> 'Pass')
        AND (bf.inputReferenceAsset IS NULL OR bf.outputAssetId IS NULL)
    `);

    if (incompleteBuyFiat.length > 0) {
      console.log(`WARNING: Found ${incompleteBuyFiat.length} BuyFiat with incomplete source data (SKIPPED):`);
      for (const tx of incompleteBuyFiat) {
        console.log(`  - Transaction ${tx.transactionId}, BuyFiat ${tx.buyFiatId}`);
      }
    }

    // Find BuyFiat transactions to fix (where bf.amlCheck='Pass' but t.amlCheck is not 'Pass')
    const buyFiatToFix = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bf.id AS buyFiatId,
        t.amlCheck AS currentTxAmlCheck,
        bf.inputReferenceAsset,
        f.name AS outputAssetName,
        bf.amountInChf
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_fiat bf ON bf.transactionId = t.id
      INNER JOIN dbo.fiat f ON bf.outputAssetId = f.id
      WHERE bf.amlCheck = 'Pass'
        AND (t.amlCheck IS NULL OR t.amlCheck <> 'Pass')
        AND bf.inputReferenceAsset IS NOT NULL
    `);

    console.log(`Found ${buyFiatToFix.length} BuyFiat transactions to fix:`);
    for (const tx of buyFiatToFix) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyFiat ${tx.buyFiatId}: ` +
          `${tx.amountInChf} CHF, assets=${tx.inputReferenceAsset}-${tx.outputAssetName}, ` +
          `current t.amlCheck=${tx.currentTxAmlCheck}`,
      );
    }

    if (buyFiatToFix.length > 0) {
      const result = await queryRunner.query(`
        UPDATE t
        SET
          t.amlCheck = 'Pass',
          t.assets = bf.inputReferenceAsset + '-' + f.name,
          t.amountInChf = bf.amountInChf,
          t.highRisk = COALESCE(bf.highRisk, 0),
          t.eventDate = bf.created,
          t.amlType = t.type,
          t.updated = GETDATE()
        FROM dbo.[transaction] t
        INNER JOIN dbo.buy_fiat bf ON bf.transactionId = t.id
        INNER JOIN dbo.fiat f ON bf.outputAssetId = f.id
        WHERE bf.amlCheck = 'Pass'
          AND (t.amlCheck IS NULL OR t.amlCheck <> 'Pass')
          AND bf.inputReferenceAsset IS NOT NULL
      `);
      console.log(`Updated ${result?.rowsAffected ?? buyFiatToFix.length} BuyFiat transaction records\n`);
    }

    // =====================================================================
    // PART 3: Reset BuyCrypto transactions where bc.amlCheck='Fail' but t.amlCheck='Pass'
    // These are chargebacks/blocks that happened after transaction was marked Pass
    // =====================================================================
    console.log('=== PART 3: BuyCrypto Fail/Pass Cleanup ===\n');

    const buyCryptoFailPass = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bc.id AS buyCryptoId,
        bc.amlReason,
        bc.chargebackDate,
        bc.amountInChf
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_crypto bc ON bc.transactionId = t.id
      WHERE bc.amlCheck = 'Fail' AND t.amlCheck = 'Pass'
    `);

    console.log(`Found ${buyCryptoFailPass.length} BuyCrypto with Fail/Pass mismatch to reset:`);
    for (const tx of buyCryptoFailPass) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyCrypto ${tx.buyCryptoId}: ` +
          `${tx.amountInChf} CHF, reason=${tx.amlReason}, chargeback=${tx.chargebackDate ?? 'none'}`,
      );
    }

    if (buyCryptoFailPass.length > 0) {
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
        WHERE bc.amlCheck = 'Fail' AND t.amlCheck = 'Pass'
      `);
      console.log(`Reset ${result?.rowsAffected ?? buyCryptoFailPass.length} BuyCrypto transaction records\n`);
    }

    // =====================================================================
    // PART 4: Reset BuyFiat transactions where bf.amlCheck='Fail' but t.amlCheck='Pass'
    // These are chargebacks/blocks that happened after transaction was marked Pass
    // =====================================================================
    console.log('=== PART 4: BuyFiat Fail/Pass Cleanup ===\n');

    const buyFiatFailPass = await queryRunner.query(`
      SELECT
        t.id AS transactionId,
        bf.id AS buyFiatId,
        bf.amlReason,
        bf.amountInChf
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_fiat bf ON bf.transactionId = t.id
      WHERE bf.amlCheck = 'Fail' AND t.amlCheck = 'Pass'
    `);

    console.log(`Found ${buyFiatFailPass.length} BuyFiat with Fail/Pass mismatch to reset:`);
    for (const tx of buyFiatFailPass) {
      console.log(
        `  - Transaction ${tx.transactionId}, BuyFiat ${tx.buyFiatId}: ` +
          `${tx.amountInChf} CHF, reason=${tx.amlReason}`,
      );
    }

    if (buyFiatFailPass.length > 0) {
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
        INNER JOIN dbo.buy_fiat bf ON bf.transactionId = t.id
        WHERE bf.amlCheck = 'Fail' AND t.amlCheck = 'Pass'
      `);
      console.log(`Reset ${result?.rowsAffected ?? buyFiatFailPass.length} BuyFiat transaction records\n`);
    }

    // =====================================================================
    // Summary
    // =====================================================================
    const totalFixed = buyCryptoToFix.length + buyFiatToFix.length;
    const totalReset = buyCryptoFailPass.length + buyFiatFailPass.length;
    console.log(`=== SUMMARY ===`);
    console.log(`  Pass sync: ${totalFixed} transactions (Parts 1-2)`);
    console.log(`  Fail reset: ${totalReset} transactions (Parts 3-4)`);
    console.log(`  Total: ${totalFixed + totalReset} transactions`);
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
