/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 2). Capture the EXACT integer base units (wei) of the ON-CHAIN SWAP
 * and BRIDGE legs at the source, mirroring stage 1 (deposits/withdrawals). Three source entities hold an on-chain leg
 * amount that an EVM >8-dp asset represents beyond the ledger's ≤8-dp float derivation:
 *   - trading_order:  amountIn (swap input, DFX float → broadcast) + amountOut (swap output, raw on-chain integer)
 *   - liquidity_order: swapAmount (DfxDex swap input) + targetAmount (DfxDex swap output)
 *   - liquidity_management_order: outputAmount (the bridged amount that arrives on the target chain)
 * Each captured value is booked verbatim into the matching ledger leg (ledger_leg.amountBaseUnits, #4280) so the swap
 * / bridge stays wei-exact end-to-end.
 *
 * Purely additive + nullable, NO historical backfill: every existing float column and behaviour is untouched. Legacy
 * rows, non-EVM chains, and any leg without a captured integer keep amountBaseUnits NULL and the ledger falls back to
 * the ≤8-dp float derivation exactly as before (fail-open) — so this migration cannot change any existing booking. A
 * backfill would only reproduce the float-derived value the ledger already computes (no precision gained), so it is
 * deliberately omitted; a row becomes exact only once a NEW swap/bridge writes its captured base units.
 *
 * Verified on: a throwaway Postgres 16 on the build host (columns add + drop cleanly, existing rows read NULL). Runs
 * at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSwapBridgeAmountBaseUnits1784600000003 {
  name = 'AddSwapBridgeAmountBaseUnits1784600000003';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "trading_order" ADD "amountInBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "trading_order" ADD "amountOutBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "swapAmountBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" ADD "targetAmountBaseUnits" numeric`);
    await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "outputAmountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "outputAmountBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "targetAmountBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "liquidity_order" DROP COLUMN "swapAmountBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "trading_order" DROP COLUMN "amountOutBaseUnits"`);
    await queryRunner.query(`ALTER TABLE "trading_order" DROP COLUMN "amountInBaseUnits"`);
  }
};
