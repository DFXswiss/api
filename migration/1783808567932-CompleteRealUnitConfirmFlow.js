/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Completes the RealUnit Aktionariat email-confirmation flow on the API side:
 *
 *  1. Adds `aktionariat_registration."requiresEmailConfirmation"` (boolean, default true) so a NEW
 *     registration is gated on the Aktionariat confirmation email, then grandfathers EVERY pre-existing
 *     row to false. Historical users predate the confirmation gate and must never be retroactively locked
 *     out of buy/sell — the read-back reports them as confirmed. Whether the historical unconfirmed users
 *     must retroactively confirm is a compliance decision; this migration deliberately does not force it (a
 *     safe, additive follow-up can flip specific rows later if compliance wants otherwise).
 *
 *  2. Hardens `real_unit_address_confirmation`: the queryable `walletAddress` becomes canonically lowercased
 *     and UNIQUE, so the per-wallet confirm upsert is race-safe and the authenticated read-back can
 *     exact-match it against the lowercased registration column. Before the UNIQUE index can exist, any
 *     rows that differ only by letter case are de-collided: the row carrying the confirmedDate latch (else
 *     the most recent) is kept and the case-variant duplicates are deleted. All remaining rows are then
 *     lowercased. The unique index reuses TypeORM's deterministic name (hash over table + column, unchanged
 *     by uniqueness) so a future `migration:generate` detects no drift against the entity's
 *     `@Index({ unique: true })`.
 *
 * Reconciliation counts (grandfathered rows, collision groups merged, duplicates deleted, rows lowercased)
 * are logged via RAISE NOTICE — nothing is changed silently.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class CompleteRealUnitConfirmFlow1783808567932 {
    name = 'CompleteRealUnitConfirmFlow1783808567932'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // 1) Confirmation gate flag. ADD ... DEFAULT true is metadata-only in Postgres (no table rewrite);
        // new inserts keep the default, existing rows are grandfathered to false just below.
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD "requiresEmailConfirmation" boolean NOT NULL DEFAULT true`);

        // 2) DML + reconciliation in one block: grandfather the gate flag, de-collide case-variants keeping
        // the confirmedDate latch, lowercase the queryable column, and RAISE NOTICE the reconciliation.
        await queryRunner.query(`
            DO $$
            DECLARE
                grandfathered_count integer;
                collision_groups integer;
                duplicates_deleted integer;
                lowercased_count integer;
            BEGIN
                -- Grandfather EVERY pre-existing registration: predates the confirmation gate, never lock out.
                UPDATE "aktionariat_registration" SET "requiresEmailConfirmation" = false;
                GET DIAGNOSTICS grandfathered_count = ROW_COUNT;

                -- Count case-collision groups (>1 row sharing the same lower(walletAddress)); expected 0 in prod.
                SELECT count(*) INTO collision_groups
                FROM (
                    SELECT lower("walletAddress")
                    FROM "real_unit_address_confirmation"
                    GROUP BY lower("walletAddress")
                    HAVING count(*) > 1
                ) g;

                -- Merge each collision group down to a single row: keep the confirmedDate latch (earliest
                -- confirmation wins, preserving the monotonic "confirmed at"), else the most recent row;
                -- delete the case-variant duplicates so the UNIQUE index below can be created.
                WITH ranked AS (
                    SELECT id,
                           ROW_NUMBER() OVER (
                               PARTITION BY lower("walletAddress")
                               ORDER BY ("confirmedDate" IS NULL) ASC,
                                        "confirmedDate" ASC NULLS LAST,
                                        "created" DESC,
                                        id DESC
                           ) AS rn
                    FROM "real_unit_address_confirmation"
                )
                DELETE FROM "real_unit_address_confirmation" rac
                USING ranked
                WHERE rac.id = ranked.id AND ranked.rn > 1;
                GET DIAGNOSTICS duplicates_deleted = ROW_COUNT;

                -- Lowercase every remaining walletAddress that is not already lowercase.
                UPDATE "real_unit_address_confirmation"
                SET "walletAddress" = lower("walletAddress")
                WHERE "walletAddress" <> lower("walletAddress");
                GET DIAGNOSTICS lowercased_count = ROW_COUNT;

                RAISE NOTICE 'CompleteRealUnitConfirmFlow reconciliation: grandfathered registrations=%, confirmation case-collision groups=%, duplicate confirmation rows deleted=%, confirmation rows lowercased=%',
                    grandfathered_count, collision_groups, duplicates_deleted, lowercased_count;
            END $$;
        `);

        // 3) Replace the non-unique walletAddress index with a UNIQUE one (same deterministic name). Runs
        // after the de-collide + lowercase above, so it cannot fail on pre-existing case-variant rows.
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cafb2b15fa9268c44081bba054"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_cafb2b15fa9268c44081bba054" ON "real_unit_address_confirmation" ("walletAddress")`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Restore the confirmation table's index to its original non-unique form (so a rolled-back entity,
        // which reverts to @Index(), matches the schema) and drop the gate column. The walletAddress values
        // are intentionally left lowercased: the original mixed-case (EIP-55 checksum) casing is not
        // reconstructable from a lowercased value, and the table is a case-insensitive audit projection.
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_cafb2b15fa9268c44081bba054"`);
        await queryRunner.query(`CREATE INDEX "IDX_cafb2b15fa9268c44081bba054" ON "real_unit_address_confirmation" ("walletAddress")`);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP COLUMN "requiresEmailConfirmation"`);
    }
}
