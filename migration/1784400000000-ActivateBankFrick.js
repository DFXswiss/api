/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PROD-ONLY data migration that activates Bank Frick in production.
 *
 * Unlike `1783944000000-AddBankFrickPayoutTracking.js` (schema only, never touched `bank` rows) and
 * unlike the `docs/bank-frick-operations.md` §3 "insert the `bank` rows manually" convention, this
 * migration deliberately owns the production activation as code. That deviation - and skipping the §6
 * sandbox checklist once - was decided by the operator; this file only encodes the mechanics.
 *
 * It is guarded to `ENVIRONMENT === 'prd'` (Environment.PRD, src/config/config.ts) and is a complete
 * no-op on dev/loc/CI: the real production IBANs and their activation must never touch a lower
 * environment, where the Bank Frick registry comes from `migration/seed/bank.csv` instead. Every step
 * is idempotent so a re-run cannot double-insert, double-rename or clobber a hand-set watermark.
 *
 * up():
 *   1. prod guard (no-op elsewhere)
 *   2. lock_timeout
 *   3. advance the identity sequence via the named sequence 'bank_id_seq' (runbook §3.1; NOT
 *      pg_get_serial_sequence, which returns NULL when the post-cutover prod sequence is not OWNED
 *      BY the column - see the step-3 inline comment) so an insert cannot collide with a lagging seq
 *   4. insert the two new Bank Frick rows (EUR/CHF) ACTIVE and idempotent per IBAN
 *   5. rename the dormant legacy Bank Frick rows to 'Bank Frick (legacy)' (runbook §3.2)
 *   6. seed `lastBankFrickDate:<newBankId>` per new row (runbook §1) so polling never starts at epoch
 *   7. drop the two default-off Frick process sentinels from `disabledProcess`
 *      (exactly the down()-SQL of 1783944000000)
 *
 * down() reverses every step, prod-guarded the same way.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class ActivateBankFrick1784400000000 {
  name = 'ActivateBankFrick1784400000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Prod-IBANs and Bank Frick activation must NEVER run on dev/loc/CI - there the registry comes
    // from migration/seed/bank.csv. Returning early still records the migration as executed, which is
    // the intended no-op on lower environments.
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // Defensive: the ON CONFLICT insert below can advance the identity sequence. Explicit-id inserts
    // elsewhere are a known source of a lagging sequence, so advance it past the highest id first
    // (GREATEST guard so it only ever moves forward, never backward into ids down() may have freed).
    // This uses the named-sequence form from the authoritative prod runbook §3.1 ('bank_id_seq'), NOT
    // pg_get_serial_sequence('bank','id'): after the MSSQL->PG cutover the prod sequence exists under
    // that name but may not be OWNED BY the column, in which case pg_get_serial_sequence returns NULL
    // and setval(NULL, ...) would crash this prd-guarded migration on boot. The local seed.js can use
    // pg_get_serial_sequence because a TypeORM-created local schema owns the sequence; prod cannot rely
    // on that.
    await queryRunner.query(
      `SELECT setval('bank_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM "bank"), (SELECT last_value FROM bank_id_seq)))`,
    );

    // sendPriority=500 makes Frick the primary sender for EUR+CHF (a full cutover from Olkypay/Yapeal,
    // whose backfilled priority is 1000); set 2000 to keep Frick fallback-only. Never 1000 - a
    // top-priority tie that includes Frick is treated as misconfiguration and throws in getPayoutAccount.
    // Self-correcting via ON CONFLICT on the unique (iban, bic) index: whether the row is new or was
    // pre-created inactive by the manual runbook §3.1 procedure (receive/send=false, sendPriority=2000),
    // it converges to the intended ACTIVE state instead of silently no-op'ing. receive=true AND send=true
    // (send-only would deadlock reconciliation, see Bank.isReconcilable); sctInst=false, amlEnabled=true.
    // Re-runnable: a re-run re-applies the same active state.
    await queryRunner.query(`
      INSERT INTO "bank"
        ("updated", "created", "name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled", "sendPriority")
      VALUES (NOW(), NOW(), 'Bank Frick', 'LI75088110105923K000E', 'BFRILI22', 'EUR', TRUE, TRUE, FALSE, TRUE, 500)
      ON CONFLICT ("iban", "bic") DO UPDATE SET
        "name" = 'Bank Frick', "receive" = TRUE, "send" = TRUE, "sctInst" = FALSE,
        "amlEnabled" = TRUE, "sendPriority" = 500, "updated" = NOW()
    `);
    await queryRunner.query(`
      INSERT INTO "bank"
        ("updated", "created", "name", "iban", "bic", "currency", "receive", "send", "sctInst", "amlEnabled", "sendPriority")
      VALUES (NOW(), NOW(), 'Bank Frick', 'LI32088110105923K000C', 'BFRILI22', 'CHF', TRUE, TRUE, FALSE, TRUE, 500)
      ON CONFLICT ("iban", "bic") DO UPDATE SET
        "name" = 'Bank Frick', "receive" = TRUE, "send" = TRUE, "sctInst" = FALSE,
        "amlEnabled" = TRUE, "sendPriority" = 500, "updated" = NOW()
    `);

    // Retire the dormant legacy Bank Frick rows so a (name, currency) lookup no longer collides
    // (runbook §3.2). Scoped by receive=false AND send=false (never matches the live rows just
    // inserted) and defensively excluded by IBAN as well.
    await queryRunner.query(`
      UPDATE "bank"
      SET "name" = 'Bank Frick (legacy)'
      WHERE "name" = 'Bank Frick'
        AND "receive" = false
        AND "send" = false
        AND "iban" NOT IN ('LI75088110105923K000E', 'LI32088110105923K000C')
    `);

    // Initial watermark seed (runbook §1): the new bankId is resolved via its IBAN. §1 offers "the
    // earliest date that should be imported" OR "now, if only new activity should be picked up"; these
    // are freshly activated accounts with no back-history to import, so the unambiguous choice is NOW()
    // ("Do not enable an account with an epoch cursor"). Written as an ISO-8601 UTC string so
    // BankTxFrickService's `new Date(value)` parses it. ON CONFLICT DO NOTHING keeps any hand-set value.
    await queryRunner.query(`
      INSERT INTO "setting" ("key", "value", "updated", "created")
      SELECT
        'lastBankFrickDate:' || "id",
        to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        NOW(),
        NOW()
      FROM "bank"
      WHERE "iban" IN ('LI75088110105923K000E', 'LI32088110105923K000C')
      ON CONFLICT ("key") DO NOTHING
    `);

    // Remove the two default-off Frick process sentinels from `disabledProcess` - EXACTLY the down()-SQL
    // of 1783944000000-AddBankFrickPayoutTracking.js (filters them out while preserving all others).
    await queryRunner.query(`
      UPDATE "setting"
      SET "value" = COALESCE((
        SELECT jsonb_agg(process)
        FROM jsonb_array_elements_text(COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb) AS processes(process)
        WHERE process NOT IN ('FiatOutputFrickTransmission', 'FiatOutputFrickStatusCheck')
      ), '[]'::jsonb)::text,
      "updated" = NOW()
      WHERE "key" = 'disabledProcess'
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // Rollout assumption: this activation is code-owned - the rows are created here, not pre-created by
    // the manual runbook §3.1 path - so down() is a clean inverse. That asymmetry is deliberate and
    // stated here because up() is defensively idempotent for the pre-created path (ON CONFLICT DO UPDATE
    // converges an existing inactive row; the watermark uses ON CONFLICT DO NOTHING to preserve a
    // hand-set value), whereas down() removes both unconditionally. So IF a row/watermark was
    // pre-created rather than inserted by up(), down() is a lossy hard-removal that does not restore the
    // prior state. Rolling back an activation that already routed a payout is likewise an Ops procedure
    // (re-point references, restore the prior row/watermark), not a plain migration revert.

    // Re-add the two default-off Frick process sentinels - EXACTLY the up()-SQL of
    // 1783944000000-AddBankFrickPayoutTracking.js (adds each only if not already present).
    await queryRunner.query(`
      INSERT INTO "setting" ("key", "value", "updated", "created")
      VALUES (
        'disabledProcess',
        '["FiatOutputFrickTransmission","FiatOutputFrickStatusCheck"]',
        NOW(),
        NOW()
      )
      ON CONFLICT ("key") DO UPDATE SET "value" = (
        COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb
        || CASE
          WHEN COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb @> '["FiatOutputFrickTransmission"]'::jsonb
          THEN '[]'::jsonb ELSE '["FiatOutputFrickTransmission"]'::jsonb
        END
        || CASE
          WHEN COALESCE(NULLIF("setting"."value", ''), '[]')::jsonb @> '["FiatOutputFrickStatusCheck"]'::jsonb
          THEN '[]'::jsonb ELSE '["FiatOutputFrickStatusCheck"]'::jsonb
        END
      )::text, "updated" = NOW()
    `);

    // Restore the legacy rows' name (runbook §3.2 rollback), scoped to dormant rows only, excluding
    // the two new IBANs. This is not a strict inverse of up(): up() only renames rows named exactly
    // 'Bank Frick', so a dormant row already named 'Bank Frick (legacy)' before this migration would
    // also be renamed here. That does not occur in the decided rollout (the legacy Frick rows are
    // named 'Bank Frick', per the runbook); a distinguishing marker would be required for a strict
    // inverse.
    await queryRunner.query(`
      UPDATE "bank" SET "name" = 'Bank Frick'
      WHERE "name" = 'Bank Frick (legacy)'
        AND "receive" = false
        AND "send" = false
        AND "iban" NOT IN ('LI75088110105923K000E', 'LI32088110105923K000C')
    `);

    // Delete the seeded watermark settings BEFORE the bank rows - the key is derived from the bank id,
    // which is looked up here via IBAN and would be gone after the rows are deleted below.
    await queryRunner.query(`
      DELETE FROM "setting"
      WHERE "key" IN (
        SELECT 'lastBankFrickDate:' || "id"
        FROM "bank"
        WHERE "iban" IN ('LI75088110105923K000E', 'LI32088110105923K000C')
      )
    `);

    // Remove the two rows this migration inserted (identified by their IBANs). Runs cleanly only BEFORE
    // the new rows are used for a payout - once fiat_output.bank / virtual_iban.bank reference them the
    // FK constraint makes this DELETE fail (fail-loud, the whole down() rolls back). See the rollout-
    // assumption note at the top of down() for the lossy pre-created-path behaviour.
    await queryRunner.query(`
      DELETE FROM "bank" WHERE "iban" IN ('LI75088110105923K000E', 'LI32088110105923K000C')
    `);
  }
};
