/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Recalibrate financeLogPairIds for toScrypt CHF.
 *
 * BankTx 190079 (19.02, 40k CHF) has no matching ExchangeTx deposit at Scrypt
 * because it was manually added, shifting the 1:1 mapping. In unfiltered mode
 * there are 23 senders (40k each) vs 22 receivers (40k each) → +40'000 CHF
 * phantom pending on Yapeal/CHF (Asset 404).
 *
 * Fix: Set both IDs so the unfiltered window starts balanced
 * (Sender = 1'370'000 CHF, Receiver = 1'370'000 CHF → toScrypt = 0).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RecalibrateScryptChfPairIds1772500000000 {
  name = 'RecalibrateScryptChfPairIds1772500000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    console.log('=== Recalibrate financeLogPairIds toScrypt CHF ===\n');

    const rows = await queryRunner.query(`SELECT id, value FROM dbo.setting WHERE [key] = 'financeLogPairIds'`);

    if (rows.length === 0) {
      console.log('ERROR: financeLogPairIds setting not found. Aborting.');
      return;
    }

    const setting = rows[0];
    const pairIds = JSON.parse(setting.value);

    console.log('Current toScrypt.chf:', JSON.stringify(pairIds.toScrypt.chf));

    pairIds.toScrypt.chf.bankTxId = 190080;
    pairIds.toScrypt.chf.exchangeTxId = 123646;

    console.log('New toScrypt.chf:', JSON.stringify(pairIds.toScrypt.chf));

    const newValue = JSON.stringify(pairIds);

    await queryRunner.query(`UPDATE dbo.setting SET value = '${newValue}' WHERE id = ${setting.id}`);

    // Verify
    const verify = await queryRunner.query(`SELECT value FROM dbo.setting WHERE id = ${setting.id}`);
    const verified = JSON.parse(verify[0].value);
    console.log('\nVerified toScrypt.chf:', JSON.stringify(verified.toScrypt.chf));
    console.log('\n=== Migration Complete ===');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    const rows = await queryRunner.query(`SELECT id, value FROM dbo.setting WHERE [key] = 'financeLogPairIds'`);

    if (rows.length === 0) return;

    const setting = rows[0];
    const pairIds = JSON.parse(setting.value);

    pairIds.toScrypt.chf.bankTxId = 186482;
    pairIds.toScrypt.chf.exchangeTxId = 116514;

    await queryRunner.query(`UPDATE dbo.setting SET value = '${JSON.stringify(pairIds)}' WHERE id = ${setting.id}`);
  }
};
