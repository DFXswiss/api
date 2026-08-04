/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Dispatch state for `AddressLetterJobService`, the API replacement of the spreadsheet automation
 * that used to send the address verification letters.
 *
 * `letterClaimDate` is the claim marker: set before an attempt, cleared again only when the attempt
 * provably did not send. It exists because `letterSentDate` cannot serve both roles - it is the AML
 * proof read by `AmlHelperService` (`AmlError.NO_LETTER`), so claiming with it would mark an account
 * as served before the letter went out, which is exactly the defect being replaced.
 *
 * `letterFailures` caps the automatic retries. The automation retried forever in an unbounded loop;
 * here a candidate leaves the queue after a bounded number of failed attempts and becomes visible as
 * `exhausted` in `AddressLetterObserver`.
 *
 * Both are plain `ALTER TABLE ... ADD COLUMN` on `user_data` - no foreign key, so the production
 * primary-key drift left behind by the MSSQL->Postgres cutover cannot be hit here. `ADD COLUMN` with a
 * constant DEFAULT is a catalog-only change since PostgreSQL 11, so this large table is not rewritten
 * and the lock is held only briefly.
 *
 * No backfill: every existing row keeps `letterClaimDate` NULL, which is what "never touched by the
 * API job" means. That is load-bearing for the observer's `sentWithoutFile` metric, which counts only
 * rows the job itself dispatched - a few thousand accounts carry a historic `letterSentDate` without a
 * `PostDispatch` KYC file and must not be reported as a defect of the new job.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAddressLetterDispatchState1785900000000 {
  name = 'AddAddressLetterDispatchState1785900000000';

  /** @param {QueryRunner} queryRunner */
  async up(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user_data" ADD "letterClaimDate" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "user_data" ADD "letterFailures" integer NOT NULL DEFAULT 0`);
  }

  /** @param {QueryRunner} queryRunner */
  async down(queryRunner) {
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "letterFailures"`);
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "letterClaimDate"`);
  }
};
