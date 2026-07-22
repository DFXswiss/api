/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Activates the ASSET ledger accounts the CoA bootstrap created inactive. The bootstrap derived
 * ledger_account.active from Asset.isActive — the OR of the user-tradability flags, which is false for every
 * custody/bank asset — so all custody/bank ASSET accounts were created with active=false. Bookings still went
 * through (account resolution does not filter on active), but the daily reconciliation, the recon status and the
 * unverified-account query all select { type: 'Asset', active: true } and therefore never covered them: drift on
 * exactly these accounts could not alarm. The code fix in this PR stops deriving active on creation; this
 * migration repairs the rows that already exist.
 *
 * Scope: every ASSET account backed by an asset row (assetId IS NOT NULL). All of them were created by the
 * bootstrap from the CoA universe (custody assets + on-chain assets with a liquidity balance), i.e. they are
 * live-booked accounts; none was deactivated deliberately (the feature predates any manual curation). Feedless or
 * dead-bank assets are safe to activate: the reconciliation classifies them (NO_FEED / BANK_DEAD / STALE) instead
 * of diff-alarming. Rows with a NULL assetId (manual intervention only) are deliberately left untouched.
 *
 * Idempotent: WHERE "active" = false, a re-run touches nothing.
 *
 * Verified on a throwaway Postgres 16: flips exactly the inactive ASSET rows with an assetId, leaves active ASSET,
 * non-ASSET and NULL-assetId rows untouched, and is a no-op (UPDATE 0) on re-run.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ActivateAssetLedgerAccounts1784600000011 {
  name = 'ActivateAssetLedgerAccounts1784600000011';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(
      `UPDATE "ledger_account" SET "active" = true WHERE "type" = 'Asset' AND "assetId" IS NOT NULL AND "active" = false`,
    );
  }

  async down() {
    // no-op: the pre-migration active=false state WAS the defect, and accounts created active=true by the fixed
    // bootstrap are indistinguishable from the repaired rows — flipping them back would re-blind reconciliation.
  }
};
