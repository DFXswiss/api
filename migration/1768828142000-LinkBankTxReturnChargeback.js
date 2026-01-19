/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Link the chargeback bank_tx to the BankTxReturn entry and set chargeback details.
 *
 * - BankTxReturn (bank_tx 186225): Incoming payment return (CRDT, 57399.75 EUR)
 * - Chargeback (bank_tx 185618): Outgoing refund to original sender (DBIT, 57399.75 EUR)
 * - Chargeback date: 2026-01-14 (booking date of bank_tx 185618)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LinkBankTxReturnChargeback1768828142000 {
  name = 'LinkBankTxReturnChargeback1768828142000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE dbo.bank_tx_return
       SET chargebackBankTxId = @0,
           chargebackAmount = @1,
           chargebackAllowedDate = @2,
           chargebackDate = @2,
           chargebackAllowedBy = @3
       WHERE bankTxId = @4`,
      [185618, 57399.75, '2026-01-14T00:00:00.000Z', 'Migration', 186225],
    );

    console.log('Linked chargeback bank_tx 185618 to BankTxReturn for bank_tx 186225 with amount 57399.75 EUR');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(
      `UPDATE dbo.bank_tx_return
       SET chargebackBankTxId = NULL,
           chargebackAmount = NULL,
           chargebackAllowedDate = NULL,
           chargebackDate = NULL,
           chargebackAllowedBy = NULL
       WHERE bankTxId = @0`,
      [186225],
    );

    console.log('Unlinked chargeback from BankTxReturn for bank_tx 186225');
  }
};
