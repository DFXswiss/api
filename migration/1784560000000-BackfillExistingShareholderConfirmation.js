/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Backfill: un-gate the RealUnit registrations that Aktionariat answered with "Existing user found, updated
 * your address." (existing share-register shareholders).
 *
 * WHY: PR #4215 gates buy quotes on a confirmed registration email. When Aktionariat matches an EXISTING
 * shareholder it updates the wallet in place and sends NO confirmation email (only newly registered emails
 * get "Confirmation email sent to ..."). Those registrations were persisted COMPLETED with
 * requiresEmailConfirmation = true and therefore hang forever on a confirmation link that never arrives.
 * The service fix persists new existing-shareholder registrations with requiresEmailConfirmation = false;
 * this migration heals the rows already stuck before the fix shipped.
 *
 * The existing-shareholder evidence is the durable Aktionariat/Registration audit row in the `log` table
 * (the designated PII audit store), whose `response.message` is "Existing user found ...". We only touch rows
 * that are (a) the active COMPLETED registration, (b) still gated (requiresEmailConfirmation = true), (c) not
 * yet confirmed (confirmedDate IS NULL — a genuinely email-confirmed row is left untouched), and (d) proven
 * existing-shareholder by such a log row for the same wallet. LOWER() both sides: the log keeps the mixed-case
 * (EIP-55) wallet, the registration column is canonically lowercased.
 *
 * Idempotent: re-running is a no-op (the requiresEmailConfirmation = true predicate no longer matches). The
 * reconciliation count is emitted via RAISE NOTICE — nothing changes silently.
 *
 * down(): intentional no-op. This is a forward-only data correction; re-gating these customers would lock
 * them back out of buy/sell, and after the service fix ships the same predicate can no longer distinguish a
 * backfilled row from a natively un-gated new existing-shareholder registration. The prior state stays
 * reconstructible from the append-only `log` rows this migration reads (never mutates).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BackfillExistingShareholderConfirmation1784560000000 {
  name = 'BackfillExistingShareholderConfirmation1784560000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
            DO $$
            DECLARE
                backfilled_count integer;
            BEGIN
                UPDATE "aktionariat_registration" r
                SET "requiresEmailConfirmation" = false
                WHERE r."active" = true
                  AND r."status" = 'Completed'
                  AND r."requiresEmailConfirmation" = true
                  AND r."confirmedDate" IS NULL
                  AND EXISTS (
                      SELECT 1 FROM "log" l
                      WHERE l."system" = 'Aktionariat'
                        AND l."subsystem" = 'Registration'
                        AND l."message" LIKE '%Existing user found%'
                        AND LOWER(l."message") LIKE '%' || LOWER(r."walletAddress") || '%'
                  );
                GET DIAGNOSTICS backfilled_count = ROW_COUNT;

                RAISE NOTICE 'BackfillExistingShareholderConfirmation: un-gated existing-shareholder registrations=%', backfilled_count;
            END $$;
        `);
  }

  /**
   * @param {QueryRunner} _queryRunner
   */
  async down(_queryRunner) {
    // No-op: forward-only data correction (see class doc).
  }
};
