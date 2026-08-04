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
 * It also switches `AddressLetter` off, following `AddBankFrickPayoutTracking1783944000000`. This is
 * not a convenience: the job dispatches physical mail, and the automation it replaces is still live.
 * Both running at once means two letters per customer, paid for twice and impossible to recall. The
 * switch therefore has to be set by the deploy itself, not by remembering an environment entry - the
 * job must never be able to start on its own. Ops removes the entry (or the `disabledProcess` setting
 * value) once the letter layout is confirmed and the old automation is verifiably off.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAddressLetterDispatchState1785900000000 {
  name = 'AddAddressLetterDispatchState1785900000000';

  /** @param {QueryRunner} queryRunner */
  async up(queryRunner) {
    // Both ALTERs take an ACCESS EXCLUSIVE lock. Without a bound, the migration waits behind any
    // long-running transaction on this table while every later query queues behind the migration -
    // a deploy-time outage. Bounded, the deploy fails fast and is retried instead.
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "user_data" ADD "letterClaimDate" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "user_data" ADD "letterFailures" integer NOT NULL DEFAULT 0`);
    // Appends without duplicating, and creates the setting when it does not exist yet.
    await queryRunner.query(`
      INSERT INTO "setting" ("key", "value", "updated", "created")
      VALUES ('disabledProcess', '["AddressLetter"]', NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE SET "value" = (
        COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb
        || CASE
          WHEN COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb @> '["AddressLetter"]'::jsonb
          THEN '[]'::jsonb ELSE '["AddressLetter"]'::jsonb
        END
      )::text, "updated" = NOW()
    `);
  }

  /**
   * Drops the columns again but deliberately LEAVES `AddressLetter` in the `disabledProcess` setting.
   *
   * `up()` cannot tell whether it added the entry or found it already there, so removing it on
   * rollback can silently delete a switch an operator set themselves. Between an orphaned entry for a
   * process that no longer exists (harmless - `DisabledProcess` just never matches it) and re-enabling
   * physical mail behind the operator's back, only one of the two is safe.
   *
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "letterFailures"`);
    await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "letterClaimDate"`);
  }
};
