/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Purges the legacy RealUnitRegistration `kyc_step` rows whose data now lives in
 * `aktionariat_registration` — ending the duplicate storage the previous cutover left behind.
 *
 * WHY the purge: migration 1783704351182-AddAktionariatRegistration made `aktionariat_registration`
 * the single source of truth and backfilled it from every RealUnitRegistration `kyc_step`, but it left
 * the source blobs on `kyc_step.result` in place. The same registration therefore lives in two tables;
 * reads have already cut over, so the legacy blob is dead duplicate data. This migration deletes every
 * legacy step whose data is *verifiably* present in the new table. Fail-safe: anything not provably
 * migrated (or still externally referenced) is KEPT and counted — never silently dropped, never crashed on.
 *
 * WHY the fence: `kyc_step` holds hundreds of foreign step types whose `result` is not valid JSON. AND
 * predicate order is not guaranteed, so an unfenced `result::jsonb` can be reordered ahead of the name
 * filter and crash this boot-blocking migration. Every cast therefore lives ONLY in the SELECT list of the
 * `steps AS MATERIALIZED` CTE, whose WHERE carries exactly the cast-free predicates
 * (name / result IS NOT NULL / pg_input_is_valid). MATERIALIZED stops the consumers' ->> guards and joins
 * from being pushed down onto a not-yet-validated row. The outer DELETE never touches `result` (only
 * `id IN (...)`); the match uses only ->> accessors, which return NULL on a scalar-but-valid blob and are
 * safely filtered — never the `- 'kycData'` operator, which throws "cannot delete from scalar".
 *
 * WHY the account-scoped criterion: a step is deletable only if all four signed fields are present
 * (walletAddress/email/registrationDate/signature) AND a matching row exists in `aktionariat_registration`
 * resolved through `user."userDataId"` — the same account-scoped resolution the backfill used, so an address
 * shared across accounts can never let one account's step be "confirmed" by another account's registration.
 * The match keys on the queryable lower(walletAddress) plus the exact signed `signature`, i.e. the row the
 * backfill actually wrote, not a mere address collision.
 *
 * WHY the FK guards: three tables reference `kyc_step("id")`. `kyc_log` cascades ON DELETE — silently
 * dropping audit rows is unacceptable — while `kyc_file` and `recommendation` are ON DELETE NO ACTION and
 * would hard-fail the boot. Any step referenced by any of the three is kept and counted (expected 0 on
 * prod/dev, verified), so the purge neither destroys audit history nor aborts the migration.
 *
 * WHY comment preservation: 33 prod steps carry `kyc_step.comment` (Aktionariat manual-review failure
 * reasons written by the pre-cutover flow — the sole record of WHY a registration went to manual review,
 * not carried into the new table). For every DELETABLE step with a comment, a row is written to the generic
 * `log` table first (system 'Aktionariat', subsystem 'Registration' — the taxonomy from PR #4167, severity
 * 'Info'), so the audit reason survives the purge. The data moves table-to-table within the same DB (same
 * confidentiality domain): no new exposure, but the reason is not lost.
 *
 * Counter partition identity (enforced with RAISE EXCEPTION, transaction mode 'all' → the whole migration
 * rolls back atomically on any mismatch): every source step lands in exactly one bucket —
 *   source_total = invalid_json + without_wallet_or_fields + unresolved_or_mismatched + kept_referenced + deleted.
 * `comments_preserved` is a sub-count of `deleted`; `remaining_after` is the live count of RealUnitRegistration
 * steps left behind (= source_total - deleted). On an empty DB every counter is 0 and nothing raises.
 *
 * Verified expectations: prod → 97 deletable / 0 kept referenced; dev → 136 deletable / 3 kept (still
 * unmigrated, correctly retained).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PurgeRealUnitRegistrationSteps1783780521095 {
    name = 'PurgeRealUnitRegistrationSteps1783780521095'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Fail fast instead of head-of-queue-blocking app boot if the DELETE's row locks on the hot
        // "kyc_step" table (or the FK re-checks against its referencing tables) are contended at deploy
        // time: a timeout rolls the migration back (transaction mode 'all') and Nest retries it rather
        // than hanging boot.
        await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

        // Single PL/pgSQL block so the classification, the log preservation, the delete and every counter
        // share one snapshot: the data-modifying CTE classifies behind the fence, preserves comments and
        // deletes in ONE statement (deleted = deletable by construction), then the reconciliation asserts
        // the partition identity and logs the counters. RAISE EXCEPTION here rolls back the whole migration.
        await queryRunner.query(`
            DO $$
            DECLARE
                source_total integer;
                invalid_json integer;
                null_result integer;
                incomplete_valid integer;
                unresolved_or_mismatched integer;
                kept_referenced integer;
                deletable_count integer;
                deleted_count integer;
                comments_preserved integer;
                without_wallet_or_fields integer;
                remaining_after integer;
                partition_sum integer;
            BEGIN
                -- Cast-free pre-delete counts. pg_input_is_valid takes text, so neither statement casts
                -- result::jsonb; both must run BEFORE the delete, which reduces the source set.
                SELECT count(*) INTO source_total
                    FROM "kyc_step" WHERE "name" = 'RealUnitRegistration';
                SELECT count(*) INTO invalid_json
                    FROM "kyc_step"
                    WHERE "name" = 'RealUnitRegistration'
                      AND result IS NOT NULL
                      AND NOT pg_input_is_valid(result, 'jsonb');
                SELECT count(*) INTO null_result
                    FROM "kyc_step"
                    WHERE "name" = 'RealUnitRegistration'
                      AND result IS NULL;

                -- Purge + classification in one snapshot.
                WITH steps AS MATERIALIZED (
                    -- The fence: result::jsonb lives ONLY here, in the SELECT list, behind cast-free
                    -- WHERE predicates. AS MATERIALIZED stops the consumers' ->> guards/joins from being
                    -- pushed down onto a not-yet-validated row.
                    SELECT ks.id, ks.status, ks.created, ks.comment, ks."userDataId", ks.result::jsonb AS blob
                    FROM "kyc_step" ks
                    WHERE ks."name" = 'RealUnitRegistration'
                      AND ks.result IS NOT NULL
                      AND pg_input_is_valid(ks.result, 'jsonb')
                ),
                classified AS (
                    -- Every ->> below runs on already-valid JSON (fenced); a scalar blob yields NULL and
                    -- is filtered by is_complete = false, never re-cast and never using the '-' operator.
                    SELECT
                        s.id,
                        s.status,
                        s.created,
                        s.comment,
                        lower(s.blob ->> 'walletAddress') AS wallet,
                        (s.blob ->> 'walletAddress' IS NOT NULL
                         AND s.blob ->> 'email' IS NOT NULL
                         AND s.blob ->> 'registrationDate' IS NOT NULL
                         AND s.blob ->> 'signature' IS NOT NULL) AS is_complete,
                        -- account-scoped: the registration must belong to the step's OWN account
                        -- ("userDataId"), keyed on the queryable lower(address) + the exact signed signature
                        EXISTS (
                            SELECT 1
                            FROM "aktionariat_registration" ar
                            JOIN "user" u ON u.id = ar."userId"
                            WHERE u."userDataId" = s."userDataId"
                              AND ar."walletAddress" = lower(s.blob ->> 'walletAddress')
                              AND ar."signature" = s.blob ->> 'signature'
                        ) AS has_match,
                        -- referenced by any of the three FK tables (kyc_log cascades; kyc_file /
                        -- recommendation are NO ACTION) → keep, never delete
                        (EXISTS (SELECT 1 FROM "kyc_log" kl WHERE kl."kycStepId" = s.id)
                         OR EXISTS (SELECT 1 FROM "kyc_file" kf WHERE kf."kycStepId" = s.id)
                         OR EXISTS (SELECT 1 FROM "recommendation" r WHERE r."kycStepId" = s.id)) AS is_referenced
                    FROM steps s
                ),
                deletable AS (
                    SELECT id, status, created, comment, wallet
                    FROM classified
                    WHERE is_complete AND has_match AND NOT is_referenced
                ),
                preserved AS (
                    -- Preserve the manual-review reason BEFORE the delete: one log row per deletable step
                    -- that carries a comment (system/subsystem taxonomy from PR #4167, severity Info).
                    INSERT INTO "log" ("system", "subsystem", "severity", "message", "category")
                    SELECT
                        'Aktionariat',
                        'Registration',
                        'Info',
                        jsonb_build_object(
                            'action', 'purgeLegacyRegistrationStep',
                            'kycStepId', d.id,
                            'status', d.status,
                            'created', d.created,
                            'comment', d.comment
                        )::text,
                        d.wallet
                    FROM deletable d
                    WHERE d.comment IS NOT NULL
                    RETURNING 1
                ),
                deleted AS (
                    -- The outer DELETE never touches result — only id IN (...). deleted = deletable.
                    DELETE FROM "kyc_step" WHERE id IN (SELECT id FROM deletable) RETURNING id
                )
                -- The three classified-derived buckets partition the complete steps exactly:
                --   deletable            = complete AND matched AND NOT referenced (the rows just deleted)
                --   unresolved_or_mismatched = complete AND NOT matched (kept: no registration in own account)
                --   kept_referenced      = complete AND matched AND referenced (would be deletable but for the FK)
                -- A referenced-but-unmatched step is still KEPT (deletable requires matched) and falls into
                -- unresolved_or_mismatched, so every complete step lands in exactly one bucket.
                SELECT
                    (SELECT count(*) FROM deletable),
                    (SELECT count(*) FROM deleted),
                    (SELECT count(*) FROM preserved),
                    (SELECT count(*) FROM classified WHERE NOT is_complete),
                    (SELECT count(*) FROM classified WHERE is_complete AND NOT has_match),
                    (SELECT count(*) FROM classified WHERE is_complete AND has_match AND is_referenced)
                INTO deletable_count, deleted_count, comments_preserved,
                     incomplete_valid, unresolved_or_mismatched, kept_referenced;

                -- Missing wallet/field bucket absorbs NULL-result rows (not in the fence) and valid-JSON
                -- rows with an incomplete blob. Computed independently so the identity check below is real.
                without_wallet_or_fields := null_result + incomplete_valid;

                SELECT count(*) INTO remaining_after
                    FROM "kyc_step" WHERE "name" = 'RealUnitRegistration';

                -- deleted must equal deletable by construction (DELETE WHERE id IN (SELECT id FROM deletable)).
                IF deleted_count <> deletable_count THEN
                    RAISE EXCEPTION 'RealUnitRegistration purge invariant violated: deleted=% <> deletable=%',
                        deleted_count, deletable_count;
                END IF;

                -- Partition identity: every source step falls into exactly one bucket. A mismatch means a
                -- classification bug or a concurrent write — roll the whole migration back rather than
                -- leave a half-purged, unaccounted state.
                partition_sum := invalid_json + without_wallet_or_fields + unresolved_or_mismatched
                    + kept_referenced + deleted_count;
                IF partition_sum <> source_total THEN
                    RAISE EXCEPTION 'RealUnitRegistration purge partition identity violated: source=% <> invalid_json(%) + without_wallet_or_fields(%) + unresolved_or_mismatched(%) + kept_referenced(%) + deleted(%)',
                        source_total, invalid_json, without_wallet_or_fields, unresolved_or_mismatched,
                        kept_referenced, deleted_count;
                END IF;

                RAISE NOTICE 'RealUnitRegistration purge reconciliation: source=%, invalid_json=%, without_wallet_or_fields=%, unresolved_or_mismatched=%, kept_referenced=%, deleted=%, comments_preserved=%, remaining_after=%',
                    source_total, invalid_json, without_wallet_or_fields, unresolved_or_mismatched,
                    kept_referenced, deleted_count, comments_preserved, remaining_after;
            END $$;
        `);
    }

    async down() {
        // Irreversible by design (same convention as 1783428526141-DeactivateCitreaTestnetAssets): the
        // deleted legacy blobs cannot be reconstructed. Their data already lives in
        // "aktionariat_registration" (the single source of truth) and every purged manual-review reason
        // was mirrored into "log" before deletion, so no information is lost — there is nothing to restore.
    }
}
