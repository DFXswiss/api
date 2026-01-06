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
    // Remove reference from buy_crypto to fiat_output entries without amount
    await queryRunner.query(`
            UPDATE buy_crypto
            SET chargebackOutputId = NULL
            WHERE chargebackOutputId IN (
                SELECT id FROM fiat_output WHERE amount IS NULL AND isComplete = 0
            )
        `);

    // Remove reference from bank_tx_return to fiat_output entries without amount
    await queryRunner.query(`
            UPDATE bank_tx_return
            SET chargebackOutputId = NULL
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
