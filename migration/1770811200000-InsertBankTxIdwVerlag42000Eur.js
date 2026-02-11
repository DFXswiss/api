/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Manually insert bank_tx for IDW Verlag GmbH EUR 42,000 payment.
 *
 * This transaction was received on the Raiffeisen EUR account (CH7780808002608614092)
 * but was not automatically imported via CAMT.053. Manual insertion is required
 * so the system can automatically process it as BUY_CRYPTO.
 *
 * Sender: IDW Verlag GmbH, Terstegenstr. 14, Düsseldorf, DE
 * Sender IBAN: DE81300700100748023900 (Deutsche Bank, BIC: DEUTDEDDXXX)
 * Amount: EUR 42,000.00 (Credit)
 * Remittance Info (bankUsage): 8641-1BEB-2009
 * Matching Buy Route: 960181 (BTC/Bitcoin, active)
 * Account IBAN: CH7780808002608614092
 * Batch: 35782
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class InsertBankTxIdwVerlag42000Eur1770811200000 {
  name = 'InsertBankTxIdwVerlag42000Eur1770811200000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const accountServiceRef = 'CUSTOM/CH7780808002608614092/2026-02-11/Gutschrift IDW Verlag GmbH';

    console.log('=== Insert BankTx: IDW Verlag GmbH EUR 42,000 ===\n');

    // Check if already exists
    const existing = await queryRunner.query(
      `SELECT id FROM dbo.bank_tx WHERE accountServiceRef = '${accountServiceRef}'`,
    );

    if (existing.length > 0) {
      console.log(`BankTx already exists with id ${existing[0].id}. Skipping.`);
      return;
    }

    // Insert the bank transaction
    await queryRunner.query(`
      INSERT INTO dbo.bank_tx (
        accountServiceRef,
        bookingDate,
        valueDate,
        amount,
        currency,
        creditDebitIndicator,
        txAmount,
        txCurrency,
        name,
        addressLine1,
        addressLine2,
        country,
        iban,
        bic,
        remittanceInfo,
        chargeAmount,
        chargeCurrency,
        chargeAmountChf,
        senderChargeAmount,
        senderChargeCurrency,
        accountIban,
        batchId,
        created,
        updated
      ) VALUES (
        '${accountServiceRef}',
        '2026-02-11',
        '2026-02-11',
        42000,
        'EUR',
        'CRDT',
        42000,
        'EUR',
        'IDW Verlag GmbH',
        'Terstegenstr. 14',
        '40476 Dusseldorf',
        'DE',
        'DE81300700100748023900',
        'DEUTDEDDXXX',
        '8641-1BEB-2009',
        0,
        'EUR',
        0,
        0,
        'EUR',
        'CH7780808002608614092',
        35782,
        GETDATE(),
        GETDATE()
      )
    `);

    // Verify insertion
    const inserted = await queryRunner.query(
      `SELECT id, accountServiceRef, amount, currency, creditDebitIndicator, txAmount, txCurrency, type
       FROM dbo.bank_tx
       WHERE accountServiceRef = '${accountServiceRef}'`,
    );

    if (inserted.length > 0) {
      console.log('Inserted successfully:');
      console.log(JSON.stringify(inserted[0], null, 2));
    } else {
      console.log('ERROR: Insert verification failed.');
    }

    console.log('\n=== Migration Complete ===');
    console.log('The next checkBankTx cron cycle (every 30s) should automatically');
    console.log('match remittanceInfo "8641-1BEB-2009" to buy route 960181 (BTC)');
    console.log('and assign type=BUY_CRYPTO.');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(
      `DELETE FROM dbo.bank_tx WHERE accountServiceRef = 'CUSTOM/CH7780808002608614092/2026-02-11/Gutschrift IDW Verlag GmbH'`,
    );
  }
};
