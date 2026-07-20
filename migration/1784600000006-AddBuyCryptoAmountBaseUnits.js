/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 4). Operational-column exactness for the buy_crypto payment entity:
 * capture the buy's crypto amounts as EXACT integer base units (wei/satoshi/lamport) ALONGSIDE the existing lossy
 * `float` columns, propagated verbatim from the amounts already captured exactly upstream at ingestion/broadcast:
 *   - "inputAmountBaseUnits"        <- crypto_input.amountBaseUnits (the on-chain DEPOSIT, stage 1) for a crypto->crypto buy
 *   - "outputAmountBaseUnits"       <- payout_order.amountBaseUnits (the on-chain WITHDRAWAL actually broadcast, stage 1)
 *   - "networkStartAmountBaseUnits" <- payout_order.amountBaseUnits of the network-start-fee payout (broadcast, stage 1)
 * All at the respective asset's own scale.
 *
 * Purely additive + nullable, NO historical backfill: the float `inputAmount`/`outputAmount`/`networkStartAmount` and
 * every existing behaviour, DTO and API wire shape are untouched. A fiat buy, a chain that does not capture broadcast
 * base units, and every legacy row keep the *BaseUnits columns NULL (fail-open) — so this migration cannot change any
 * existing value or booking. A backfill would only reproduce the <=8-dp float-derived value (no precision gained), so it
 * is deliberately omitted; a row becomes exact only once a NEW buy propagates its captured upstream base units.
 *
 * Verified on: a throwaway Postgres 16 on the build host (columns add + drop cleanly, existing rows read NULL). Runs at
 * boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBuyCryptoAmountBaseUnits1784600000006 {
  name = 'AddBuyCryptoAmountBaseUnits1784600000006';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "inputAmountBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "outputAmountBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "networkStartAmountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "networkStartAmountBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "outputAmountBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "inputAmountBaseUnits"`);
  }
};
