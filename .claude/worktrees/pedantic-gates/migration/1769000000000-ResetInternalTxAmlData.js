/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset transaction AML data for internal transactions without buy_fiat records.
 *
 * These 5 transactions belong to internal account (userDataId: 307373) and have
 * transaction.amlCheck='Pass' but no corresponding buy_fiat record exists.
 * The amlCheck was incorrectly set directly on the transaction table.
 *
 * Affected transactions:
 * - 233620: 369,800 CHF (ZCHF via transaction_request)
 * - 234402: 148,587 CHF (USDT via transaction_request)
 * - 247570: 175,740 CHF (ZCHF, crypto_input with wrong routeId)
 * - 251658: 17,122 CHF (XMR, crypto_input with wrong routeId)
 * - 251662: 27,319 CHF (XMR, crypto_input with wrong routeId)
 *
 * Total: 738,568 CHF
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetInternalTxAmlData1769000000000 {
  name = 'ResetInternalTxAmlData1769000000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const internalTxIds = [233620, 234402, 247570, 251658, 251662];

    console.log('=== Reset Internal Transaction AML Data ===\n');

    // Verify these are the expected transactions
    const txToReset = await queryRunner.query(`
      SELECT
        t.id,
        t.uid,
        t.amlCheck,
        t.amountInChf,
        t.userDataId,
        t.type
      FROM dbo.[transaction] t
      WHERE t.id IN (${internalTxIds.join(',')})
        AND t.amlCheck = 'Pass'
        AND t.userDataId = 307373
    `);

    console.log(`Found ${txToReset.length} internal transactions to reset:`);
    for (const tx of txToReset) {
      console.log(
        `  - Transaction ${tx.id} (${tx.uid}): ${tx.amountInChf} CHF, ` +
          `type=${tx.type}, userDataId=${tx.userDataId}`,
      );
    }

    if (txToReset.length === 0) {
      console.log('No matching transactions found. Skipping.\n');
      return;
    }

    // Verify no buy_fiat exists for these transactions
    const hasBuyFiat = await queryRunner.query(`
      SELECT t.id
      FROM dbo.[transaction] t
      INNER JOIN dbo.buy_fiat bf ON bf.transactionId = t.id
      WHERE t.id IN (${internalTxIds.join(',')})
    `);

    if (hasBuyFiat.length > 0) {
      console.log(`WARNING: Found ${hasBuyFiat.length} transactions with buy_fiat records. Aborting.`);
      return;
    }

    // Reset the amlCheck and related fields
    const result = await queryRunner.query(`
      UPDATE dbo.[transaction]
      SET
        amlCheck = NULL,
        amountInChf = NULL,
        assets = NULL,
        highRisk = NULL,
        eventDate = NULL,
        amlType = NULL,
        updated = GETDATE()
      WHERE id IN (${internalTxIds.join(',')})
        AND amlCheck = 'Pass'
        AND userDataId = 307373
    `);

    console.log(`Reset ${result?.rowsAffected ?? txToReset.length} internal transaction records\n`);

    console.log('=== SUMMARY ===');
    console.log(`  Reset: ${txToReset.length} internal transactions`);
    console.log(
      `  Total volume removed from amlCheck=Pass: ${txToReset.reduce((sum, tx) => sum + (tx.amountInChf || 0), 0)} CHF`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // This migration resets incorrectly set amlCheck for internal transactions.
    // Rolling back would return the data to an incorrect state.
    console.log('Down migration is a no-op. Rolling back would return data to an incorrect state.');
  }
};
