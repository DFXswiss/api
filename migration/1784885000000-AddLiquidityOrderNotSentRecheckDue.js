/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Marks a liquidity management order that a not-sent resolution has failed, until reconciliation has looked
 * at it once more.
 *
 * A resolution concluding that a request never reached the venue can be written at the same moment another
 * pass is watching the venue confirm that very order. Whichever writes first wins the row, and if the
 * confirmation is the one that loses — or simply cannot be written — it is gone, while the failed order
 * leaves its rule free to plan against funds that are in fact committed. The reconciliation pass that runs
 * next closes that window, and this column is what makes such an order findable for it: on the row rather
 * than in process memory, so a restart in between does not lose the obligation, and cleared as soon as the
 * look has happened, so settled failures are not queried against the venue every ten seconds thereafter.
 * It records work still owed, not when the resolution happened — that goes into the order's own reason,
 * which nothing clears.
 *
 * Purely additive and nullable, no backfill: existing rows read NULL, which is exactly right — they predate
 * the resolution path entirely and have nothing awaiting a second look. The index is the deterministic
 * TypeORM name for a single-column index on this table, matching the entity's `@Index()`.
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
