/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * §2.3 native-first exactness (phase 1, issue #4280). Companion backfill to 1784600000000: that migration set
 * amountBaseUnits for asset-backed legs; this one fills the TRANSIT counter of a SAME-currency internal transfer.
 * A TRANSIT account is keyed by currency ticker and carries NO assetId, so its decimals cannot be read from the
 * account — they come from the paired ASSET leg WITHIN THE SAME tx (mirrors the runtime populateTransferCounterBaseUnits
 * in ledger-booking.service). Once both sides carry base units the pair cancels to 0 exactly, which is what
 * assertNativeBalance now enforces for new bookings; this heals the existing rows to the same value.
 *
 * Out-of-order timestamp (1784600000001, one tick after the column-adding migration) so it always runs AFTER the
 * column exists. Scope guard mirrors the service exactly — the whole tx must be a same-currency internal transfer
 * (every leg on an ASSET or TRANSIT account, exactly one account currency) AND its ASSET legs must share EXACTLY ONE
 * distinct decimals (unambiguous); a cross-asset trade or a mixed-decimals tx is left untouched. Only assetId-less
 * TRANSIT legs still NULL are updated, so the backfill is idempotent (a re-run touches nothing) and never overwrites
 * a value already written by the booking service. The amount is rounded to 8 dp FIRST (§2.3 convention, matching
 * prepareLeg and the sibling migration) so the numeric round after scaling recovers the intended integer.
 *
 * Verified on: a throwaway Postgres 16 with a synthetic dataset — the backfilled transit legs make every
 * same-currency transfer tx sum to 0 in base units. Runs at boot via SQL_MIGRATE (fail-closed).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BackfillLedgerTransitBaseUnits1784600000001 {
  name = 'BackfillLedgerTransitBaseUnits1784600000001';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`
      UPDATE "ledger_leg" l
      SET "amountBaseUnits" = round(round(l."amount"::numeric, 8) * power(10::numeric, t."decimals"))
      FROM (
        SELECT
          leg."txId" AS "txId",
          MAX(a."decimals") FILTER (WHERE acc."type" = 'Asset') AS "decimals"
        FROM "ledger_leg" leg
        JOIN "ledger_account" acc ON acc."id" = leg."accountId"
        LEFT JOIN "asset" a ON a."id" = acc."assetId"
        GROUP BY leg."txId"
        HAVING
          bool_and(acc."type" IN ('Asset', 'Transit'))
          AND COUNT(DISTINCT acc."currency") = 1
          AND COUNT(DISTINCT a."decimals") FILTER (
            WHERE acc."type" = 'Asset' AND acc."assetId" IS NOT NULL AND a."decimals" IS NOT NULL
          ) = 1
      ) t,
      "ledger_account" lacc
      WHERE l."txId" = t."txId"
        AND lacc."id" = l."accountId"
        AND lacc."type" = 'Transit'
        AND lacc."assetId" IS NULL
        AND l."amountBaseUnits" IS NULL
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // No-op: the backfilled TRANSIT base units are indistinguishable from ones the booking service writes for new
    // transfers, so nulling them here would also strip legitimately booked values. The column itself is dropped by
    // the companion migration 1784600000000 on a full revert.
  }
};
