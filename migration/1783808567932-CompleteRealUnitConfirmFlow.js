/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Consolidates the RealUnit Aktionariat email-confirmation flow onto ONE business table and the DB `log`
 * audit store, removing the separate `real_unit_address_confirmation` table.
 *
 * WHY: the confirmed STATE is a per-wallet fact and every wallet has exactly one active registration, so it
 * belongs ON `aktionariat_registration` (read back directly, no cross-table string bridge, no case-mismatch).
 * The FULL, append-only history of every confirm call — including a 0-match one — already goes to the DB
 * `log` table (system Aktionariat / subsystem Confirmation), the designated PII audit store. The standalone
 * projection table therefore only duplicated state and naming problems; this migration folds it away.
 *
 * up():
 *  1. Add `aktionariat_registration."confirmedDate"` (the first-confirmation latch = customer-facing state).
 *  2. Add `aktionariat_registration."requiresEmailConfirmation"` (default true) and grandfather EVERY
 *     pre-existing row to false — historical users predate the confirmation gate and must never be locked out
 *     of buy/sell. Whether they must retroactively confirm is a compliance decision this migration does not
 *     force (a safe additive follow-up can flip specific rows later).
 *  3. Bridge the confirmed state: copy each confirmation's `confirmedDate` onto the matching ACTIVE
 *     registration, joining case-insensitively via LOWER() because the confirmation rows carry the mixed-case
 *     (EIP-55 checksummed) wallet while the registration column is canonically lowercased.
 *  4. Preserve every existing confirmation's full data as one `Aktionariat/Confirmation` row in the DB `log`
 *     so nothing is lost when the table is dropped (the runtime confirm flow writes the same shape).
 *  5. Drop `real_unit_address_confirmation`.
 *
 * Reconciliation counts (grandfathered rows, confirmedDate rows bridged, confirmations preserved to the log)
 * are logged via RAISE NOTICE — nothing is changed silently.
 *
 * down(): reverses enough that the pre-PR code works again — recreates `real_unit_address_confirmation` in its
 * ORIGINAL shape (see the base migration 1783515852971) and reconstructs the confirmed rows from the
 * registration's `confirmedDate` (walletAddress + confirmedDate suffice for the old read-back; the other
 * columns are filled with placeholders and the preserved DB-`log` rows are NOT removed, as noted below), then
 * drops the two added columns.
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
        // 1) First-confirmation latch on the registration (the single source of truth for the confirmed state).
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD "confirmedDate" TIMESTAMP`);

        // 2) Confirmation gate flag. ADD ... DEFAULT true is metadata-only in Postgres (no table rewrite);
        // new inserts keep the default, existing rows are grandfathered to false in the block below.
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD "requiresEmailConfirmation" boolean NOT NULL DEFAULT true`);

        // 3) + 4) DML + reconciliation in one block: grandfather the gate flag, bridge the confirmed state onto
        // the active registrations (LOWER join — confirmations are mixed-case), preserve every confirmation as a
        // DB-`log` audit row, and RAISE NOTICE the reconciliation counts.
        await queryRunner.query(`
            DO $$
            DECLARE
                grandfathered_count integer;
                confirmed_bridged_count integer;
                confirmations_preserved_count integer;
            BEGIN
                -- Grandfather EVERY pre-existing registration: predates the confirmation gate, never lock out.
                UPDATE "aktionariat_registration" SET "requiresEmailConfirmation" = false;
                GET DIAGNOSTICS grandfathered_count = ROW_COUNT;

                -- Bridge the confirmed state onto the ACTIVE registration for each confirmed wallet. LOWER() on
                -- both sides: the confirmation rows carry the mixed-case (checksummed) wallet, the registration
                -- column is canonically lowercased.
                UPDATE "aktionariat_registration" r
                SET "confirmedDate" = c."confirmedDate"
                FROM "real_unit_address_confirmation" c
                WHERE LOWER(r."walletAddress") = LOWER(c."walletAddress")
                  AND r."active" = true
                  AND c."confirmedDate" IS NOT NULL;
                GET DIAGNOSTICS confirmed_bridged_count = ROW_COUNT;

                -- Preserve every confirmation's full data as an append-only DB log audit row before the table
                -- is dropped, matching the runtime confirm-flow shape (system/subsystem/category/severity/valid).
                -- The response column keeps the stored raw JSON text as-is (lossless, never throws on bad data);
                -- severity is mapped from the recorded responseStatus exactly as the runtime flow maps it.
                INSERT INTO "log" ("system", "subsystem", "severity", "message", "category", "valid")
                SELECT
                    'Aktionariat',
                    'Confirmation',
                    CASE
                        WHEN c."responseStatus" BETWEEN 200 AND 299 THEN 'Info'
                        WHEN c."responseStatus" BETWEEN 400 AND 499 THEN 'Warning'
                        ELSE 'Error'
                    END,
                    json_build_object(
                        'action', 'confirmConnection',
                        'walletAddress', c."walletAddress",
                        'email', c."email",
                        'aktionariatUser', c."aktionariatUser",
                        'aktionariatCode', c."aktionariatCode",
                        'responseStatus', c."responseStatus",
                        'response', c."response",
                        'confirmedDate', c."confirmedDate",
                        'migratedFrom', 'real_unit_address_confirmation',
                        'migratedAt', now()
                    )::text,
                    'ServerCall',
                    NULL
                FROM "real_unit_address_confirmation" c;
                GET DIAGNOSTICS confirmations_preserved_count = ROW_COUNT;

                RAISE NOTICE 'CompleteRealUnitConfirmFlow consolidation: grandfathered registrations=%, confirmedDate bridged onto registrations=%, confirmations preserved to DB log=%',
                    grandfathered_count, confirmed_bridged_count, confirmations_preserved_count;
            END $$;
        `);

        // 5) Drop the now-redundant standalone projection table (its state lives on the registration, its full
        // history in the DB `log`). No FKs reference it.
        await queryRunner.query(`DROP TABLE "real_unit_address_confirmation"`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Recreate the confirmation table in its ORIGINAL shape (base migration 1783515852971): a non-unique
        // walletAddress index, reusing TypeORM's deterministic index name so a rolled-back @Index() matches.
        await queryRunner.query(`CREATE TABLE "real_unit_address_confirmation" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "walletAddress" character varying(256) NOT NULL, "email" character varying(256) NOT NULL, "aktionariatUser" character varying(256) NOT NULL, "aktionariatCode" character varying(256) NOT NULL, "confirmedDate" TIMESTAMP, "responseStatus" integer, "response" text, CONSTRAINT "PK_0545f4521355f5be7157fd56468" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_cafb2b15fa9268c44081bba054" ON "real_unit_address_confirmation" ("walletAddress")`);

        // Reconstruct just what the pre-PR read-back queried: one confirmation row per confirmed wallet, keyed
        // by the lowercased walletAddress + confirmedDate. WHY the rest is lossy: aktionariatUser/aktionariatCode
        // /responseStatus/response are not derivable from the registration (they only ever lived in the dropped
        // table / the DB `log`), so the NOT NULL user/code columns get empty-string placeholders. The preserved
        // `Aktionariat/Confirmation` DB-`log` rows written by up() are deliberately NOT deleted here — they are
        // the durable audit trail and must survive a schema rollback.
        await queryRunner.query(`
            INSERT INTO "real_unit_address_confirmation" ("walletAddress", "email", "aktionariatUser", "aktionariatCode", "confirmedDate")
            SELECT LOWER(r."walletAddress"), r."email", '', '', r."confirmedDate"
            FROM "aktionariat_registration" r
            WHERE r."confirmedDate" IS NOT NULL
        `);

        // Drop the two added registration columns.
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP COLUMN "requiresEmailConfirmation"`);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP COLUMN "confirmedDate"`);
    }
}
