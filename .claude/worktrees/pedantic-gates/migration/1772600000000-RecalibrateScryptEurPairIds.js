/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Recalibrate financeLogPairIds for toScrypt EUR (second recalibration).
 *
 * The receiver side (eurReceiverScryptExchangeTx) includes ALL Scrypt EUR deposits,
 * while the sender side (eurSenderScryptBankTx) is filtered by eurBankIbans (Olkypay +
 * Yapeal only). Former MaerkiBaumann transfers (bank_tx 191068: 363k, 191069: 42k)
 * created exchange_tx deposits but are excluded from the bank_tx sender list, causing
 * a 281k EUR mismatch and a negative toScryptUnfiltered.
 *
 * Fix: Move the pair IDs forward to the latest settled pair:
 *   bankTxId 191523 (30k EUR, Olkypay, Mar 4)
 *   exchangeTxId 126558 (30k EUR, Scrypt DEPOSIT, Mar 4)
 *
 * This excludes orphan exchange_tx and MaerkiBaumann bank_tx from the window,
 * correctly showing only the pending 30k EUR transfer.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RecalibrateScryptEurPairIds1772600000000 {
  name = 'RecalibrateScryptEurPairIds1772600000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    console.log('=== Recalibrate financeLogPairIds toScrypt EUR (2nd) ===\n');

    const rows = await queryRunner.query(
      `SELECT id, value FROM dbo.setting WHERE [key] = 'financeLogPairIds'`,
    );

    if (rows.length === 0) {
      console.log('ERROR: financeLogPairIds setting not found. Aborting.');
      return;
    }

    const setting = rows[0];
    const pairIds = JSON.parse(setting.value);

    console.log('Current toScrypt.eur:', JSON.stringify(pairIds.toScrypt.eur));

    pairIds.toScrypt.eur.bankTxId = 191523;
    pairIds.toScrypt.eur.exchangeTxId = 126558;

    console.log('New toScrypt.eur:', JSON.stringify(pairIds.toScrypt.eur));

    const newValue = JSON.stringify(pairIds);

    await queryRunner.query(
      `UPDATE dbo.setting SET value = '${newValue}' WHERE id = ${setting.id}`,
    );

    // Verify
    const verify = await queryRunner.query(
      `SELECT value FROM dbo.setting WHERE id = ${setting.id}`,
    );
    const verified = JSON.parse(verify[0].value);
    console.log('\nVerified toScrypt.eur:', JSON.stringify(verified.toScrypt.eur));
    console.log('\n=== Migration Complete ===');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    const rows = await queryRunner.query(
      `SELECT id, value FROM dbo.setting WHERE [key] = 'financeLogPairIds'`,
    );

    if (rows.length === 0) return;

    const setting = rows[0];
    const pairIds = JSON.parse(setting.value);

    pairIds.toScrypt.eur.bankTxId = 190029;
    pairIds.toScrypt.eur.exchangeTxId = 123655;

    await queryRunner.query(
      `UPDATE dbo.setting SET value = '${JSON.stringify(pairIds)}' WHERE id = ${setting.id}`,
    );
  }
};
