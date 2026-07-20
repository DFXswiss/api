/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (issue #4287 stage 4). Operational-column exactness for the ref_reward payment entity:
 * capture the referral reward's crypto payout as EXACT integer base units (wei/satoshi/lamport) ALONGSIDE the existing
 * lossy `float` column, propagated verbatim from the amount already captured exactly upstream at on-chain broadcast:
 *   - "outputAmountBaseUnits" <- payout_order.amountBaseUnits of the REF_PAYOUT payout actually broadcast (stage 1)
 * At the output asset's own scale.
 *
 * Purely additive + nullable, NO historical backfill: the float `outputAmount` and every existing behaviour, DTO and
 * API wire shape are untouched. A chain that does not capture broadcast base units, an incomplete reward, and every
 * legacy row keep the "outputAmountBaseUnits" column NULL (fail-open) — so this migration cannot change any existing
 * value or booking. A backfill would only reproduce the <=8-dp float-derived value (no precision gained), so it is
 * deliberately omitted; a row becomes exact only once a NEW ref reward propagates its captured upstream base units.
 *
 * Verified on: a throwaway Postgres 16 on the build host (column adds + drops cleanly, existing rows read NULL). Runs
 * at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRefRewardOutputAmountBaseUnits1784600000009 {
  name = 'AddRefRewardOutputAmountBaseUnits1784600000009';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "ref_reward" ADD "outputAmountBaseUnits" numeric`);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "ref_reward" DROP COLUMN "outputAmountBaseUnits"`);
  }
};
