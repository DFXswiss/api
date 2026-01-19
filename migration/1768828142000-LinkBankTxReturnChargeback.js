/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Link the chargeback bank_tx to the BankTxReturn entry and set all required fields.
 *
 * - BankTxReturn (bank_tx 186225): Incoming payment return (CRDT, 57399.75 EUR)
 * - Chargeback (bank_tx 185618): Outgoing refund to original sender (DBIT, 57399.75 EUR)
 * - Chargeback date: 2026-01-14 (booking date of bank_tx 185618)
 *
 * Fixes:
 * 1. BankTxReturn 452: Set chargeback link and fiat amounts (cron won't process due to NULL chargebackOutputId)
 * 2. bank_tx 185618: Fix type from 'Internal' to 'BankTxReturn-Chargeback'
 * 3. transaction 295791: Fix type from 'Internal' to 'BankTxReturn-Chargeback'
 *
 * Exchange rates from 2026-01-14: EUR/CHF=0.932, EUR/USD=1.161
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
    const chargebackAmount = 57399.75;
    const amountInEur = chargebackAmount; // Already in EUR
    const amountInChf = Math.round(chargebackAmount * 0.932 * 100) / 100; // 53496.57
    const amountInUsd = Math.round(chargebackAmount * 1.161 * 100) / 100; // 66641.11

    await queryRunner.query(
      `UPDATE dbo.bank_tx_return
       SET chargebackBankTxId = @0,
           chargebackAmount = @1,
           chargebackAllowedDate = @2,
           chargebackDate = @2,
           chargebackAllowedBy = @3,
           amountInEur = @4,
           amountInChf = @5,
           amountInUsd = @6,
           info = @7,
           chargebackRemittanceInfo = @8
       WHERE bankTxId = @9`,
      [
        185618,
        chargebackAmount,
        '2026-01-14T00:00:00.000Z',
        'Migration',
        amountInEur,
        amountInChf,
        amountInUsd,
        'NA',
        'Manual chargeback via bank statement (Migration)',
        186225,
      ],
    );

    console.log(
      `Linked chargeback bank_tx 185618 to BankTxReturn 452 (bank_tx 186225): ${chargebackAmount} EUR, ${amountInChf} CHF, ${amountInUsd} USD`,
    );

    // Fix bank_tx 185618 type: 'Internal' -> 'BankTxReturn-Chargeback'
    await queryRunner.query(`UPDATE dbo.bank_tx SET type = @0 WHERE id = @1`, [
      'BankTxReturn-Chargeback',
      185618,
    ]);
    console.log('Fixed bank_tx 185618 type: Internal -> BankTxReturn-Chargeback');

    // Fix transaction 295791 type: 'Internal' -> 'BankTxReturn-Chargeback'
    await queryRunner.query(`UPDATE dbo.[transaction] SET type = @0 WHERE id = @1`, [
      'BankTxReturn-Chargeback',
      295791,
    ]);
    console.log('Fixed transaction 295791 type: Internal -> BankTxReturn-Chargeback');
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
           chargebackAllowedBy = NULL,
           amountInEur = NULL,
           amountInChf = NULL,
           amountInUsd = NULL,
           info = NULL,
           chargebackRemittanceInfo = NULL
       WHERE bankTxId = @0`,
      [186225],
    );

    console.log('Unlinked chargeback and reset fiat amounts for BankTxReturn (bank_tx 186225)');

    // Revert bank_tx 185618 type back to 'Internal'
    await queryRunner.query(`UPDATE dbo.bank_tx SET type = @0 WHERE id = @1`, ['Internal', 185618]);
    console.log('Reverted bank_tx 185618 type: BankTxReturn-Chargeback -> Internal');

    // Revert transaction 295791 type back to 'Internal'
    await queryRunner.query(`UPDATE dbo.[transaction] SET type = @0 WHERE id = @1`, ['Internal', 295791]);
    console.log('Reverted transaction 295791 type: BankTxReturn-Chargeback -> Internal');
  }
};
