/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix bank_tx 189011: Set missing txAmount and txCurrency.
 *
 * The Raiffeisen CAMT.053 XML has AmtDtls at Ntry level, not at NtryDtls.TxDtls level.
 * The SEPA parser only reads from NtryDtls.TxDtls.AmtDtls, causing txAmount and txCurrency
 * to be NULL. This prevents automatic BUY_CRYPTO assignment because createFromBankTx uses
 * txAmount/txCurrency as inputAmount/inputAsset, and the NULL inputAsset causes a TypeError
 * in getAndCompleteTxRequest (Cannot read properties of null reading 'id').
 *
 * Fix: Copy the values from amount/currency (which were correctly parsed from NtryDtls.TxDtls.Amt).
 *
 * BankTx: 189011
 * Amount: 363000 EUR
 * AccountServiceRef: CUSTOM/CH7780808002608614092/2026-02-10/Gutschrift Eucon Digital GmbH
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixBankTx189011MissingTxAmount1770791640000 {
  name = 'FixBankTx189011MissingTxAmount1770791640000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const bankTxId = 189011;

    console.log('=== Fix BankTx 189011: Missing txAmount/txCurrency ===\n');

    // Verify current state
    const current = await queryRunner.query(`
      SELECT id, amount, currency, txAmount, txCurrency, type
      FROM dbo.bank_tx
      WHERE id = ${bankTxId}
    `);

    if (current.length === 0) {
      console.log('ERROR: BankTx not found. Aborting.');
      return;
    }

    const bt = current[0];
    console.log('Current state:');
    console.log(`  ID: ${bt.id}`);
    console.log(`  amount: ${bt.amount}, currency: ${bt.currency}`);
    console.log(`  txAmount: ${bt.txAmount}, txCurrency: ${bt.txCurrency}`);
    console.log(`  type: ${bt.type}`);
    console.log('');

    if (bt.txAmount !== null) {
      console.log('txAmount already set. Skipping.');
      return;
    }

    // Update txAmount and txCurrency from amount/currency
    console.log('Updating txAmount and txCurrency...');
    await queryRunner.query(`
      UPDATE dbo.bank_tx
      SET
        txAmount = amount,
        txCurrency = currency,
        updated = GETDATE()
      WHERE id = ${bankTxId}
    `);

    // Verify final state
    console.log('\n=== Verification ===');
    const final = await queryRunner.query(`
      SELECT id, amount, currency, txAmount, txCurrency, type
      FROM dbo.bank_tx
      WHERE id = ${bankTxId}
    `);
    console.log('Final state:', JSON.stringify(final[0], null, 2));

    console.log('\n=== Migration Complete ===');
    console.log('The next checkBankTx cron cycle (every 30s) should now automatically');
    console.log('assign type=BUY_CRYPTO and create the BuyCrypto entity.');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      UPDATE dbo.bank_tx
      SET
        txAmount = NULL,
        txCurrency = NULL,
        updated = GETDATE()
      WHERE id = 189011
    `);
  }
};
