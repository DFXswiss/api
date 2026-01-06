/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Manual assignment of 3 failed crypto_input transactions to their payment_link_payments.
 *
 * Background: Due to float precision mismatch in payment_quote matching (e.g., 8923.33 vs 8923.329187),
 * these payments were not automatically matched despite having valid payment_link_payments.
 *
 * Affected transactions (all from same sender, userDataId 243813):
 * - crypto_input 428462: 4,040.43 USDT -> payment_link_payment 13346
 * - crypto_input 428463: 970.88 USDT -> payment_link_payment 13348
 * - crypto_input 428464: 8,923.33 USDT -> payment_link_payment 13349
 *
 * Total: ~14,815 USDT (ca. 11,048 CHF)
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ManualPaymentLinkAssignment1767726863673 {
  name = 'ManualPaymentLinkAssignment1767726863673';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Transaction 1: crypto_input 428462 (4,040.43 USDT) -> payment_quote 42892 -> payment_link_payment 13346
    await queryRunner.query(`
      UPDATE payment_quote
      SET txId = '0xb30c9426a3637bd60491999f84bdb27b87c29a02c7edf1b4371c4b382bfe9f95',
          txBlockchain = 'Ethereum',
          status = 'TxBlockchain'
      WHERE id = 42892
    `);

    await queryRunner.query(`
      UPDATE crypto_input
      SET paymentQuoteId = 42892,
          paymentLinkPaymentId = 13346,
          status = 'Created'
      WHERE id = 428462
    `);

    await queryRunner.query(`
      UPDATE [transaction]
      SET userDataId = 243813
      WHERE id = 294538
    `);

    await queryRunner.query(`
      UPDATE payment_link_payment
      SET status = 'Completed'
      WHERE id = 13346
    `);

    // Transaction 2: crypto_input 428463 (970.88 USDT) -> payment_quote 42894 -> payment_link_payment 13348
    await queryRunner.query(`
      UPDATE payment_quote
      SET txId = '0xc7e585e720d3ca21f444a9e8a2d709412d3966e0f14a028b2377d201fcfa1f2e',
          txBlockchain = 'Ethereum',
          status = 'TxBlockchain'
      WHERE id = 42894
    `);

    await queryRunner.query(`
      UPDATE crypto_input
      SET paymentQuoteId = 42894,
          paymentLinkPaymentId = 13348,
          status = 'Created'
      WHERE id = 428463
    `);

    await queryRunner.query(`
      UPDATE [transaction]
      SET userDataId = 243813
      WHERE id = 294539
    `);

    await queryRunner.query(`
      UPDATE payment_link_payment
      SET status = 'Completed'
      WHERE id = 13348
    `);

    // Transaction 3: crypto_input 428464 (8,923.33 USDT) -> payment_quote 42896 -> payment_link_payment 13349
    await queryRunner.query(`
      UPDATE payment_quote
      SET txId = '0x1c275428a69ca8f3ec9778dd8b6f152221f532bf472129916019b4ae42941041',
          txBlockchain = 'Ethereum',
          status = 'TxBlockchain'
      WHERE id = 42896
    `);

    await queryRunner.query(`
      UPDATE crypto_input
      SET paymentQuoteId = 42896,
          paymentLinkPaymentId = 13349,
          status = 'Created'
      WHERE id = 428464
    `);

    await queryRunner.query(`
      UPDATE [transaction]
      SET userDataId = 243813
      WHERE id = 294540
    `);

    await queryRunner.query(`
      UPDATE payment_link_payment
      SET status = 'Completed'
      WHERE id = 13349
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Revert Transaction 1
    await queryRunner.query(`UPDATE payment_link_payment SET status = 'Pending' WHERE id = 13346`);
    await queryRunner.query(`UPDATE [transaction] SET userDataId = NULL WHERE id = 294538`);
    await queryRunner.query(`UPDATE crypto_input SET paymentQuoteId = NULL, paymentLinkPaymentId = NULL, status = 'Failed' WHERE id = 428462`);
    await queryRunner.query(`UPDATE payment_quote SET txId = NULL, txBlockchain = NULL, status = 'Expired' WHERE id = 42892`);

    // Revert Transaction 2
    await queryRunner.query(`UPDATE payment_link_payment SET status = 'Pending' WHERE id = 13348`);
    await queryRunner.query(`UPDATE [transaction] SET userDataId = NULL WHERE id = 294539`);
    await queryRunner.query(`UPDATE crypto_input SET paymentQuoteId = NULL, paymentLinkPaymentId = NULL, status = 'Failed' WHERE id = 428463`);
    await queryRunner.query(`UPDATE payment_quote SET txId = NULL, txBlockchain = NULL, status = 'Expired' WHERE id = 42894`);

    // Revert Transaction 3
    await queryRunner.query(`UPDATE payment_link_payment SET status = 'Pending' WHERE id = 13349`);
    await queryRunner.query(`UPDATE [transaction] SET userDataId = NULL WHERE id = 294540`);
    await queryRunner.query(`UPDATE crypto_input SET paymentQuoteId = NULL, paymentLinkPaymentId = NULL, status = 'Failed' WHERE id = 428464`);
    await queryRunner.query(`UPDATE payment_quote SET txId = NULL, txBlockchain = NULL, status = 'Expired' WHERE id = 42896`);
  }
};
