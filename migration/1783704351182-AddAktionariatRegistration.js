/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Creates the queryable, per-wallet `aktionariat_registration` table — the single source of truth for
 * RealUnit Aktionariat share-register registrations — and backfills it from every existing
 * RealUnitRegistration `kyc_step`, then reads cut over to it (the JSON blob on kyc_step.result stops
 * being written). One row per wallet (FK -> "user"), with a partial unique index enforcing a single
 * ACTIVE registration per wallet-user (historical rows stay as active = false).
 *
 * Constraint/index names are TypeORM's deterministic DefaultNamingStrategy values —
 * `<prefix> + sha1(table + '_' + columns.join('_') [+ '_' + where])` truncated to 27 hex chars for
 * PK_/UQ_/FK_/DF_ and 26 for IDX_/CHK_/XCL_/REL_ — so a future `migration:generate` detects no drift
 * against the entity's @PrimaryGeneratedColumn / @Index / @ManyToOne decorators.
 *
 * Backfill (atomic with the DDL, transaction mode 'all'):
 *  - `walletAddress` = lower(result->>'walletAddress'); `signedPayload` = result minus 'kycData';
 *    `kycData` = result->'kycData'; email/registrationDate/signature from the blob.
 *  - `status` mapped: Completed -> COMPLETED; Failed/Canceled kept (terminal, inactive); every other
 *    non-terminal state (e.g. InternalReview) -> ManualReview, so it is admin-re-forwardable and never
 *    stuck between "not COMPLETED" and "not MANUAL_REVIEW".
 *  - `userId` via a de-duplicated join on "user" (lowest id per lower(address)) so a non-unique
 *    address column cannot fan the row out.
 *  - `active` = the most recent NON-TERMINAL step per wallet-user (terminal Failed/Canceled sorted last
 *    in the ranking), guaranteeing <= 1 active row and no partial-unique-index clash. A wallet-user whose
 *    steps are all terminal keeps no active row; failed/canceled steps are migrated but never active.
 *  - `forwardedToAktionariatDate` = kyc_step.updated for COMPLETED steps, else null.
 *  - Only structurally complete blobs are migrated (walletAddress + email + registrationDate + signature
 *    all present, all NOT NULL columns); a defective blob is steered out and counted, never crashes the
 *    boot-blocking migration.
 *  - Reconciliation counts are logged via RAISE NOTICE (source / with wallet / with required fields /
 *    inserted / unresolved user / field missing / blob without wallet) — nothing is silently dropped.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddAktionariatRegistration1783704351182 {
    name = 'AddAktionariatRegistration1783704351182'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Fail fast instead of head-of-queue-blocking every "user" write if the FK's SHARE ROW
        // EXCLUSIVE lock on the hot "user" table is contended at deploy time: a timeout rolls the
        // migration back (transaction mode 'all') and Nest retries it rather than hanging app boot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);
        await queryRunner.query(`CREATE TABLE "aktionariat_registration" ("id" SERIAL NOT NULL, "updated" TIMESTAMP NOT NULL DEFAULT now(), "created" TIMESTAMP NOT NULL DEFAULT now(), "walletAddress" character varying(256) NOT NULL, "email" character varying(256) NOT NULL, "registrationDate" character varying(256) NOT NULL, "signature" text NOT NULL, "signedPayload" text, "kycData" text, "status" character varying(256) NOT NULL, "forwardedToAktionariatDate" TIMESTAMP, "active" boolean NOT NULL DEFAULT true, "userId" integer NOT NULL, CONSTRAINT "PK_af158ecdcaff6229223fe33f2ee" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_365c6bdac6a7883581aea34bbd" ON "aktionariat_registration" ("userId") WHERE "active" = true`);
        await queryRunner.query(`CREATE INDEX "IDX_21d1d4854aa5b13f2038752af0" ON "aktionariat_registration" ("userId") `);
        await queryRunner.query(`CREATE INDEX "IDX_754aadd3add69f81ce36ecfe33" ON "aktionariat_registration" ("walletAddress") `);
        await queryRunner.query(`CREATE INDEX "IDX_9d6dbb2ed29c342b4568971231" ON "aktionariat_registration" ("email") `);
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" ADD CONSTRAINT "FK_21d1d4854aa5b13f2038752af00" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);

        // --- Backfill from existing RealUnitRegistration kyc_steps (single source of truth cutover) ---
        await queryRunner.query(`
            INSERT INTO "aktionariat_registration"
                ("walletAddress", "email", "registrationDate", "signature", "signedPayload", "kycData",
                 "status", "forwardedToAktionariatDate", "active", "userId", "created", "updated")
            SELECT
                lower(src.blob ->> 'walletAddress'),
                src.blob ->> 'email',
                src.blob ->> 'registrationDate',
                src.blob ->> 'signature',
                (src.blob - 'kycData')::text,
                (src.blob -> 'kycData')::text,
                -- map the lifecycle onto the runtime states: Completed stays, terminal Failed/Canceled
                -- stay terminal, every other non-terminal state becomes ManualReview (admin-re-forwardable)
                CASE
                    WHEN src.status = 'Completed' THEN 'Completed'
                    WHEN src.status IN ('Failed', 'Canceled') THEN src.status
                    ELSE 'ManualReview'
                END,
                CASE WHEN src.status = 'Completed' THEN src.updated ELSE NULL END,
                -- active = newest NON-terminal row per wallet-user (terminal steps ranked last); uses the
                -- ORIGINAL kyc_step.status for the terminal test, so an all-terminal user gets no active row
                (src.rn = 1 AND src.status NOT IN ('Failed', 'Canceled')),
                src.user_id,
                src.created,
                src.updated
            FROM (
                SELECT
                    ks.status AS status,
                    ks.created AS created,
                    ks.updated AS updated,
                    ks.result::jsonb AS blob,
                    u.id AS user_id,
                    ROW_NUMBER() OVER (
                        PARTITION BY u.id
                        ORDER BY (CASE WHEN ks.status IN ('Failed', 'Canceled') THEN 1 ELSE 0 END) ASC,
                                 ks.created DESC, ks.id DESC
                    ) AS rn
                FROM "kyc_step" ks
                JOIN (
                    SELECT DISTINCT ON (lower("address")) id, lower("address") AS laddr
                    FROM "user"
                    ORDER BY lower("address"), id
                ) u ON u.laddr = lower(ks.result::jsonb ->> 'walletAddress')
                WHERE ks."name" = 'RealUnitRegistration'
                  AND ks.result IS NOT NULL
                  AND (ks.result::jsonb ->> 'walletAddress') IS NOT NULL
                  AND (ks.result::jsonb ->> 'email') IS NOT NULL
                  AND (ks.result::jsonb ->> 'registrationDate') IS NOT NULL
                  AND (ks.result::jsonb ->> 'signature') IS NOT NULL
            ) src
        `);

        // --- Reconciliation: count source vs. migrated and every non-resolvable remainder (logged, not dropped) ---
        await queryRunner.query(`
            DO $$
            DECLARE
                source_total integer;
                source_with_wallet integer;
                source_with_required integer;
                inserted_count integer;
                unresolved_user integer;
                field_missing integer;
                blob_without_wallet integer;
            BEGIN
                SELECT count(*) INTO source_total
                    FROM "kyc_step" WHERE "name" = 'RealUnitRegistration';
                SELECT count(*) INTO source_with_wallet
                    FROM "kyc_step"
                    WHERE "name" = 'RealUnitRegistration'
                      AND result IS NOT NULL
                      AND (result::jsonb ->> 'walletAddress') IS NOT NULL;
                SELECT count(*) INTO source_with_required
                    FROM "kyc_step"
                    WHERE "name" = 'RealUnitRegistration'
                      AND result IS NOT NULL
                      AND (result::jsonb ->> 'walletAddress') IS NOT NULL
                      AND (result::jsonb ->> 'email') IS NOT NULL
                      AND (result::jsonb ->> 'registrationDate') IS NOT NULL
                      AND (result::jsonb ->> 'signature') IS NOT NULL;
                SELECT count(*) INTO inserted_count FROM "aktionariat_registration";
                field_missing := source_with_wallet - source_with_required; -- wallet present but a NOT NULL field missing
                unresolved_user := source_with_required - inserted_count;    -- complete blob but no matching "user"
                blob_without_wallet := source_total - source_with_wallet;    -- no walletAddress at all
                RAISE NOTICE 'AktionariatRegistration backfill reconciliation: source RealUnitRegistration steps=%, with walletAddress=%, with required fields=%, inserted=%, unresolved user (no user)=%, field missing=%, blob without walletAddress=%',
                    source_total, source_with_wallet, source_with_required, inserted_count, unresolved_user, field_missing, blob_without_wallet;
            END $$;
        `);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "aktionariat_registration" DROP CONSTRAINT "FK_21d1d4854aa5b13f2038752af00"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9d6dbb2ed29c342b4568971231"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_754aadd3add69f81ce36ecfe33"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_21d1d4854aa5b13f2038752af0"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_365c6bdac6a7883581aea34bbd"`);
        await queryRunner.query(`DROP TABLE "aktionariat_registration"`);
    }
}
