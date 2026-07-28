/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Release the one provably-never-sent Scrypt liquidity order (id 127664) from quarantine, so its rule
 * unblocks on deploy.
 *
 * Quarantine exists for requests whose outcome cannot be proven. This one's can: the stored connection
 * failure is thrown before any bytes leave the process, the venue never knew the reference across eight
 * hours of lookups, and the position the order was meant to move never drained and was manually converted
 * at the venue. Nothing at the venue can materialise later, so the order becomes an ordinary failure.
 *
 * Guards, and what each protects against:
 * - the compare-and-set on "status": if the admin endpoint releases the order before this deploys, the row
 *   is no longer 'Uncertain' and the migration is a clean no-op instead of overwriting a fresher resolution.
 * - "correlationId" plus the "created" day window: id sequences differ between environments' databases, so a
 *   bare id could hit an unrelated row elsewhere; the reference and creation date pin the exact production
 *   order and match nothing else.
 *
 * "notSentRecheckDue" is cleared because the entity's own resolveAsNotSent() always clears it alongside the
 * status flip. Pipeline and rule rows are deliberately untouched: the state machine cascades on its own —
 * checkRunningPipelines observes the failed order, fails the pipeline, pauses the rule, and the rule
 * auto-reactivates.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ReleaseUncertainScryptOrder1276641785400000000 {
  name = 'ReleaseUncertainScryptOrder1276641785400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
    await queryRunner.query(`
      UPDATE "liquidity_management_order"
      SET "status" = 'Failed',
          "notSentRecheckDue" = NULL,
          "errorMessage" = COALESCE("errorMessage", '') || ' (released by migration: request provably never sent — the stored connection failure is thrown before any bytes leave the process; the venue never knew reference dfx-lm-127664 across 8h of lookups; the EUR position never drained and was manually converted at the venue on 2026-07-28 19:27 UTC)'
      WHERE "id" = 127664
        AND "status" = 'Uncertain'
        AND "correlationId" = 'dfx-lm-127664'
        AND "created" >= '2026-07-28' AND "created" < '2026-07-29'
    `);
  }

  async down() {
    // deliberate no-op: a released quarantine must never be re-armed by a revert
  }
};
