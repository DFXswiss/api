/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Adds `custody_order.completedAt` — the immutable valuta timestamp
 * CustodyService.calculateAccruedInterest() relies on. `updated` cannot serve this role: it
 * is a TypeORM `@UpdateDateColumn` overwritten on every `.save()`, including harmless
 * re-saves of an already-Completed order (CustodyOrderService.updateCustodyOrderInternal(),
 * called from five places across buy-crypto/buy-fiat/custody-job with no guard against
 * re-saving a completed order) — a silent re-save would push the interest start date
 * forward and shrink the reported balance without a trace.
 *
 * `completedAt` is set exactly once, the first time an order becomes Completed (see
 * CustodyOrder.complete() and CustodyOrderService.updateCustodyOrderInternal()), and is
 * never overwritten afterward.
 *
 * Backfills existing Completed orders with their current `updated` value: for historical
 * rows this is the best available approximation of the true completion time (no better
 * source exists), and only loses precision for rows re-saved after completion, before this
 * column existed.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCustodyOrderCompletedAt1785196928914 {
  name = 'AddCustodyOrderCompletedAt1785196928914';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "custody_order" ADD "completedAt" TIMESTAMP`);
    await queryRunner.query(`
      UPDATE "custody_order"
      SET "completedAt" = "updated"
      WHERE "status" = 'Completed' AND "completedAt" IS NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "custody_order" DROP COLUMN "completedAt"`);
  }
};
