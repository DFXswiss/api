/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Fix 6 bank transactions with inconsistent data:
 * DBIT indicator with negative amounts.
 *
 * For DBIT (debit) transactions, the amount should be positive
 * (the indicator determines the direction). These 6 transactions
 * have negative amounts with DBIT indicator, causing calculation errors.
 *
 * Affected transactions:
 * - ID 173381: ZV20251014/918520/1, -0.21 EUR -> 0.21 EUR
 * - ID 173380: ZV20251014/918518/1, -0.21 EUR -> 0.21 EUR
 * - ID 171434: ZV20250929/910632/1, -0.20 EUR -> 0.20 EUR
 * - ID 164288: ZV20250806/885809/1, -0.20 EUR -> 0.20 EUR
 * - ID 158783: ZV20250623/864252/1, -0.11 EUR -> 0.11 EUR
 * - ID 155408: ZV20250521/850592/1, -0.20 EUR -> 0.20 EUR
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class FixBankTxDbitNegativeAmounts1768819785000 {
  name = 'FixBankTxDbitNegativeAmounts1768819785000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Fix the 6 DBIT transactions with negative amounts
    const result = await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "amount" = ABS("amount"),
          "instructedAmount" = ABS("instructedAmount"),
          "txAmount" = ABS("txAmount")
      WHERE "id" IN (173381, 173380, 171434, 164288, 158783, 155408)
        AND "amount" < 0
        AND "creditDebitIndicator" = 'DBIT'
    `);

    console.log('Fixed DBIT transactions with negative amounts:', result);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Revert to negative amounts
    await queryRunner.query(`
      UPDATE "dbo"."bank_tx"
      SET "amount" = -ABS("amount"),
          "instructedAmount" = -ABS("instructedAmount"),
          "txAmount" = -ABS("txAmount")
      WHERE "id" IN (173381, 173380, 171434, 164288, 158783, 155408)
        AND "creditDebitIndicator" = 'DBIT'
    `);

    console.log('Reverted DBIT transactions to negative amounts');
  }
};
