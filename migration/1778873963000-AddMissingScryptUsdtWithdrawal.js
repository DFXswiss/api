/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add missing Scrypt USDT Withdrawal that was not picked up by the
 * exchange sync job. The on-chain Tron transfer is verified
 * (Scrypt → Binance Hot Wallet → DFX), and the receiving Binance
 * deposit is correctly recorded as exchange_tx with exchange='Binance'.
 * Only the Scrypt-side Withdrawal record is missing.
 *
 * Withdrawal details:
 *   Amount:           63'140.0826 USDT
 *   externalCreated:  2026-04-13T09:47:48Z (Tron block 81802005 timestamp)
 *   txId:             cd3191af012bc797f747f1083b96ba8651eb628176cb8d0a3951ed9462d31bad
 *
 * Verification:
 *   Tron Block 81802005:
 *     Scrypt-Wallet TExZbGuTh1XgAn47Wt573ZTqkfCmUuWTXY
 *       → Binance Hot TDyfzdnNqrXEVqrUyZQSGSEGfSHTAYkFD3 (63'140.0826 USDT)
 *   Tron Block 81802029 (+72 seconds):
 *     Binance Hot   → DFX TGF6FQc9zdXK6sa4u9qkNCcjQDMApQr9Ru (63'140.0826 USDT)
 *     = exchange_tx 133988 (exchange='Binance', type='Deposit', status='ok')
 *
 * Root cause (suspected): in-memory cache in ScryptService.balanceTransactions
 * was incomplete when syncExchangeJob ran, and the 12-hour default
 * since-window in getSyncSinceDate did not catch the entry on subsequent
 * runs once it was outside the cache window.
 *
 * externalId uses a deterministic 'MANUAL_RECONCILE_*' prefix derived from
 * the on-chain txId, so future runs of the sync job cannot create a duplicate
 * via the (exchange, externalId, type) lookup. If Scrypt's API ever returns
 * the original Scrypt-internal id for this Withdrawal in a backfill, that
 * record will be added as a separate row and a follow-up reconciliation
 * step should merge it.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMissingScryptUsdtWithdrawal1778873963000 {
  name = 'AddMissingScryptUsdtWithdrawal1778873963000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    const txId = 'cd3191af012bc797f747f1083b96ba8651eb628176cb8d0a3951ed9462d31bad';

    const existing = await queryRunner.query(`
      SELECT "id" FROM "dbo"."exchange_tx"
      WHERE "exchange" = 'Scrypt' AND "type" = 'Withdrawal' AND "txId" = '${txId}'
    `);

    if (existing.length > 0) {
      console.log(`Scrypt USDT Withdrawal with txId ${txId} already exists, skipping`);
      return;
    }

    await queryRunner.query(`
      INSERT INTO "dbo"."exchange_tx" (
        "exchange",
        "type",
        "externalId",
        "externalCreated",
        "status",
        "amount",
        "currency",
        "txId"
      ) VALUES (
        'Scrypt',
        'Withdrawal',
        'MANUAL_RECONCILE_cd3191af',
        '2026-04-13T09:47:48.000Z',
        'ok',
        63140.0826,
        'USDT',
        '${txId}'
      )
    `);

    console.log(`Inserted missing Scrypt USDT Withdrawal: 63'140.0826 USDT, txId ${txId}`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`
      DELETE FROM "dbo"."exchange_tx"
      WHERE "exchange" = 'Scrypt'
        AND "type" = 'Withdrawal'
        AND "externalId" = 'MANUAL_RECONCILE_cd3191af'
    `);

    console.log("Deleted manual Scrypt USDT Withdrawal reconciliation entry");
  }
};
