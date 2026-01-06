/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class CleanupFiatOutputWithoutAmount1767734994504 {
  name = 'CleanupFiatOutputWithoutAmount1767734994504';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Reset chargebackAllowedDate and chargebackOutputId in buy_crypto
    // so the chargebackTx job can recreate fiat_output with correct amount
    await queryRunner.query(`
            UPDATE buy_crypto
            SET chargebackOutputId = NULL, chargebackAllowedDate = NULL
            WHERE chargebackOutputId IN (
                SELECT id FROM fiat_output WHERE amount IS NULL AND isComplete = 0
            )
        `);

    // Reset chargebackAllowedDate and chargebackOutputId in bank_tx_return
    // so the chargeback job can recreate fiat_output with correct amount
    await queryRunner.query(`
            UPDATE bank_tx_return
            SET chargebackOutputId = NULL, chargebackAllowedDate = NULL
            WHERE chargebackOutputId IN (
                SELECT id FROM fiat_output WHERE amount IS NULL AND isComplete = 0
            )
        `);

    // Reset chargebackAllowedDate and chargebackOutputId in bank_tx_repeat
    // so the chargeback job can recreate fiat_output with correct amount
    await queryRunner.query(`
            UPDATE bank_tx_repeat
            SET chargebackOutputId = NULL, chargebackAllowedDate = NULL
            WHERE chargebackOutputId IN (
                SELECT id FROM fiat_output WHERE amount IS NULL AND isComplete = 0
            )
        `);

    // Delete fiat_output entries without amount
    await queryRunner.query(`
            DELETE FROM fiat_output WHERE amount IS NULL AND isComplete = 0
        `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Cannot restore deleted data
  }
};
