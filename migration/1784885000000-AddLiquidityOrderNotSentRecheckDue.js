/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Marks a liquidity management order somebody has released as never sent, until the venue has been asked
 * once more. While the column is set the order stays quarantined: the release is accepted, not yet in effect.
 *
 * Concluding that a request never reached the venue is the one judgement nothing here can verify from the
 * outside, and it can be made at the very moment reconciliation is watching the venue confirm that same
 * order. Were the release to take effect at once, the order would be terminal — its rule free to plan
 * against funds that are in fact committed — before anything could contradict it. Waiting for one machine
 * answer costs a single reconciliation pass, normally seconds, and closes that window entirely.
 *
 * The column records work outstanding, not when the release was asked for: that goes into the order's own
 * reason, which nothing clears. Indexed so the wait never turns into a scan.
 *
 * Purely additive and nullable, no backfill: existing rows read NULL, which is exactly right — they predate
 * this path entirely and have no release awaiting confirmation. The index is the deterministic TypeORM name
 * for a single-column index on this table, matching the entity's `@Index()`.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddLiquidityOrderNotSentRecheckDue1784885000000 {
  name = 'AddLiquidityOrderNotSentRecheckDue1784885000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "liquidity_management_order" ADD "notSentRecheckDue" TIMESTAMP`);
    await queryRunner.query(
      `CREATE INDEX "IDX_cfc953689f0268e33cf14c1cc0" ON "liquidity_management_order" ("notSentRecheckDue")`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DROP INDEX "public"."IDX_cfc953689f0268e33cf14c1cc0"`);
    await queryRunner.query(`ALTER TABLE "liquidity_management_order" DROP COLUMN "notSentRecheckDue"`);
  }
};
