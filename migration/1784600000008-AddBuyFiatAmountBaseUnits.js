/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 4). Operational-column exactness for the buy_fiat payment entity
 * (the SELL flow: crypto in -> fiat out). Capture the crypto the user SOLD as EXACT integer base units
 * (wei/satoshi/lamport) ALONGSIDE the existing lossy `float` column, propagated verbatim from the amount already
 * captured exactly upstream at on-chain deposit ingestion (stage 1):
 *   - "inputAmountBaseUnits" <- crypto_input.amountBaseUnits (the on-chain DEPOSIT of the sold crypto, stage 1)
 * at the asset's own scale. This is the sell flow's ONLY crypto leg with an exact upstream integer: the OUTPUT is a
 * fiat bank transfer (no on-chain base units), and the CHF/fee columns keep their own exact model (amountChfCents).
 *
 * Purely additive + nullable, NO historical backfill: the float `inputAmount` and every existing behaviour, DTO and
 * API wire shape are untouched. A legacy row and any deposit whose chain did not capture base units keep the column
 * NULL (fail-open) — so this migration cannot change any existing value or booking. A backfill would only reproduce
 * the <=8-dp float-derived value (no precision gained), so it is deliberately omitted; a row becomes exact only once a
 * NEW sell propagates its captured upstream base units.
 *
 * Verified on: a throwaway Postgres 16 on the build host (column adds + drops cleanly, existing rows read NULL). Runs
 * at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBuyFiatAmountBaseUnits1784600000008 {
  name = 'AddBuyFiatAmountBaseUnits1784600000008';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "inputAmountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "inputAmountBaseUnits"`);
  }
};
