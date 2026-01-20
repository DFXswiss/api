/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Reset EUR fiat_output transactions that were processed before EUR blocking was enabled.
 *
 * These 8 transactions were transmitted via Yapeal and need to be reset
 * so they can be reprocessed when EUR payouts are re-enabled.
 *
 * Affected transactions:
 * - ID 79157: BuyFiat, 392.39 EUR
 * - ID 79158: BuyFiat, 205.03 EUR
 * - ID 79161: BuyFiat, 99.46 EUR
 * - ID 79162: BuyCryptoFail, 2994.61 EUR
 * - ID 79163: BuyCryptoFail, 47.79 EUR
 * - ID 79164: BuyCryptoFail, 115.71 EUR
 * - ID 79165: BuyFiat, 16.17 EUR
 * - ID 79166: BuyFiat, 364.72 EUR
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ResetEurFiatOutputTransactions1737392400000 {
  name = 'ResetEurFiatOutputTransactions1737392400000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const result = await queryRunner.query(`
      UPDATE "dbo"."fiat_output"
      SET "isReadyDate" = NULL,
          "isTransmittedDate" = NULL,
          "isApprovedDate" = NULL,
          "yapealMsgId" = NULL
      WHERE "id" IN (79157, 79158, 79161, 79162, 79163, 79164, 79165, 79166)
        AND "currency" = 'EUR'
        AND "isComplete" = 0
    `);

    console.log('Reset EUR fiat_output transactions:', result);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Cannot restore original timestamps - manual intervention required
    console.log('Down migration not supported - original timestamps cannot be restored');
  }
};
