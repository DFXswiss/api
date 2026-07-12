/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Creates the versioned, append-only `real_unit_legal_acceptance` table — the RealUnit-scoped store of each
 * user's acceptance of the six legal agreements shown in the RealUnit app's legal-disclaimer wizard. One row
 * per accepted (userData, agreement, version); the current version of every agreement lives in config
 * (Config.blockchain.realunit.legalVersions), so a version bump needs no migration and a user whose latest
 * accepted version no longer matches is reported as needing re-acceptance.
 *
 * Constraint/index names are TypeORM's deterministic DefaultNamingStrategy values —
 * `<prefix> + sha1(table + '_' + columns.sort().join('_'))` truncated to 27 hex chars for PK_/FK_/UQ_ and 26
 * for IDX_ — so a future `migration:generate` detects no drift against the entity's decorators.
 *
 * up() also runs a ONE-TIME grandfathering backfill (product decision 2026-07-12): every already-registered
 * RealUnit account is seeded with the current-version acceptance of all six agreements so existing users are
 * not re-prompted at rollout. See the DO block below for the exact criterion and idempotency guard.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddRealUnitLegalAcceptance1783900000000 {
    name = 'AddRealUnitLegalAcceptance1783900000000'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Fail fast instead of head-of-queue-blocking every "user_data" write if the FK's SHARE ROW EXCLUSIVE
        // lock on the hot "user_data" table is contended at deploy time: the timeout aborts with a clear
        // lock_timeout error (rolling back the batch in transaction mode 'all') instead of hanging app boot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`CREATE TABLE "real_unit_legal_acceptance" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "agreement" character varying(256) NOT NULL, "version" character varying(256) NOT NULL, "acceptedDate" TIMESTAMP NOT NULL, "userDataId" integer NOT NULL, CONSTRAINT "PK_75802f050b85988206de9c4838c" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_f0dca3c8e72f9051863167a8d6" ON "real_unit_legal_acceptance" ("userDataId", "agreement", "version") `);
        await queryRunner.query(`ALTER TABLE "real_unit_legal_acceptance" ADD CONSTRAINT "FK_37ef26b0bfa9d3b85294c95a5a2" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        // --- One-time grandfathering per product decision 2026-07-12: seed current-version acceptance for
        // already-registered RealUnit wallets ---
        await queryRunner.query(`
            DO $$
            DECLARE
                registered_count integer;
                inserted_count integer;
            BEGIN
                -- Grandfather = the account has EVER completed an aktionariat_registration (status = 'Completed'
                -- = ReviewStatus.COMPLETED). This is DELIBERATELY NARROWER than getRegistrationInfo's "registered"
                -- (findRegistration counts an active row in ANY non-FAILED/CANCELED status, incl. MANUAL_REVIEW):
                -- fail-closed for a legal-consent store — pre-seed acceptance only for users we are certain
                -- finished the flow; a rare active-but-in-review user is asked to accept once at rollout rather
                -- than having consent assumed. The registration hangs on the wallet-"user" FK, so user_data is
                -- resolved via "user"."userDataId"; DISTINCT collapses a multi-wallet account to one set of rows.
                SELECT count(*) INTO registered_count
                FROM (
                    SELECT DISTINCT u."userDataId"
                    FROM "aktionariat_registration" ar
                    JOIN "user" u ON u.id = ar."userId"
                    WHERE ar."status" = 'Completed' AND u."userDataId" IS NOT NULL
                ) registered;

                -- Insert the six current-version acceptances per registered account. The NOT EXISTS anti-join
                -- makes this idempotent against the unique (userDataId, agreement, version) index, so a re-run
                -- (or an account that accepted in-app before the migration lands) never duplicates or violates.
                -- acceptedDate is a single fixed grandfather timestamp (the rollout date) — cleaner than casting
                -- and aggregating each wallet's registrationDate, and the created column keeps the true row age.
                INSERT INTO "real_unit_legal_acceptance" ("userDataId", "agreement", "version", "acceptedDate", "created", "updated")
                SELECT registered."userDataId", agreement."name", '20260712', TIMESTAMP '2026-07-12 00:00:00', now(), now()
                FROM (
                    SELECT DISTINCT u."userDataId"
                    FROM "aktionariat_registration" ar
                    JOIN "user" u ON u.id = ar."userId"
                    WHERE ar."status" = 'Completed' AND u."userDataId" IS NOT NULL
                ) registered
                CROSS JOIN (VALUES
                    ('ResidenceConfirmation'),
                    ('TaxDomicileSelfCertification'),
                    ('RealUnitPrivacyPolicy'),
                    ('RealUnitRegistrationAgreement'),
                    ('AktionariatTermsOfService'),
                    ('DfxTermsAndConditions')
                ) AS agreement("name")
                WHERE NOT EXISTS (
                    SELECT 1 FROM "real_unit_legal_acceptance" existing
                    WHERE existing."userDataId" = registered."userDataId"
                      AND existing."agreement" = agreement."name"
                      AND existing."version" = '20260712'
                );
                GET DIAGNOSTICS inserted_count = ROW_COUNT;

                RAISE NOTICE 'RealUnitLegalAcceptance grandfathering: already-registered accounts (COMPLETED)=%, acceptance rows inserted=%',
                    registered_count, inserted_count;
            END $$;
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        // Dropping the table removes the grandfathered rows too — no extra teardown needed.
        await queryRunner.query(`ALTER TABLE "real_unit_legal_acceptance" DROP CONSTRAINT "FK_37ef26b0bfa9d3b85294c95a5a2"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_f0dca3c8e72f9051863167a8d6"`);
        await queryRunner.query(`DROP TABLE "real_unit_legal_acceptance"`);
    }
}
