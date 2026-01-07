/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset chargebackAmount for stuck refunds so users can re-initiate the refund flow.
 *
 * Problem: 42 transactions have chargebackDate set but chargebackAllowedDate is NULL,
 * causing them to be stuck in "Refund pending" state. The API endpoint blocks re-refund
 * when chargebackAmount is set.
 *
 * Solution: Reset chargebackAmount to NULL so users can request refund again via API.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetStuckRefundChargebackAmount1767795194463 {
  name = 'ResetStuckRefundChargebackAmount1767795194463';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Reset chargebackAmount for stuck BuyCrypto refunds (36 entries, ~12,645 EUR)
    await queryRunner.query(`
      UPDATE buy_crypto
      SET chargebackAmount = NULL
      WHERE chargebackDate IS NOT NULL
        AND chargebackAllowedDate IS NULL
        AND isComplete = 0
    `);

    // Reset chargebackAmount for stuck BankTxReturn refunds (6 entries, ~292 EUR)
    await queryRunner.query(`
      UPDATE bank_tx_return
      SET chargebackAmount = NULL
      WHERE chargebackDate IS NOT NULL
        AND chargebackAllowedDate IS NULL
        AND chargebackOutputId IS NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Cannot restore original chargebackAmount values - this is a one-way migration
    // The values will be re-set when users re-initiate the refund flow
  }
};
