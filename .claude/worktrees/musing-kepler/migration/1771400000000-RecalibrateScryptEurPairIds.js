/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Recalibrate financeLogPairIds for toScrypt EUR after aggregation fix.
 *
 * PR #3237 changed EUR Scrypt pending from per-bank attribution to currency-level
 * aggregation under the Scrypt/EUR asset. The existing pair IDs created mismatched
 * windows (bankTxId 186375 vs exchangeTxId 116468), causing 365k more ExchangeTx
 * deposits than BankTx debits in the unfiltered calculation — resulting in a negative
 * plusBalance for Scrypt/EUR.
 *
 * Fix: Set both IDs to the latest settled transaction + 1, so the unfiltered window
 * starts fresh with 0 pending.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RecalibrateScryptEurPairIds1771400000000 {
  name = 'RecalibrateScryptEurPairIds1771400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    console.log('=== Recalibrate financeLogPairIds toScrypt EUR ===\n');

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

    pairIds.toScrypt.eur.bankTxId = 190029;
    pairIds.toScrypt.eur.exchangeTxId = 123655;

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

    pairIds.toScrypt.eur.bankTxId = 186375;
    pairIds.toScrypt.eur.exchangeTxId = 116468;

    await queryRunner.query(
      `UPDATE dbo.setting SET value = '${JSON.stringify(pairIds)}' WHERE id = ${setting.id}`,
    );
  }
};
