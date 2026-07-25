/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const REF_SETTING_KEY = 'ref-keys';
const DENARIO_ALIAS = 'denario';
// Pin the Denario organization by its immutable prod user_data.id (the onboarded partner account).
// Resolving by the editable organizationName would let anyone who completes Organization KYC under the
// name "Denario" hijack the referral routing; a numeric account id cannot be user-edited. Safe to hardcode
// because this migration is prd-only (see up()).
const DENARIO_USER_DATA_ID = 408808;
const REF_CODE_FORMAT = /^\w{1,3}-\w{1,3}$/;
const AUDIT_MIGRATION = 'AddDenarioPermanentRef1784994100000';
const APPLY_ACTION = 'applyDenarioReferralAlias';
const ROLLBACK_ACTION = 'rollbackDenarioReferralAlias';

/**
 * Parse the ref-keys setting without silently replacing corrupt configuration.
 *
 * @param {{ value: string } | undefined} row
 * @returns {Record<string, string>}
 */
function parseRefKeys(row) {
  if (!row) return {};

  let refKeys;
  try {
    refKeys = JSON.parse(row.value);
  } catch {
    throw new Error(`Setting '${REF_SETTING_KEY}' does not contain valid JSON`);
  }

  if (!refKeys || typeof refKeys !== 'object' || Array.isArray(refKeys)) {
    throw new Error(`Setting '${REF_SETTING_KEY}' must contain a JSON object`);
  }

  return refKeys;
}

/**
 * Return the single apply event that has not yet been matched by a rollback event.
 * Audit rows are append-only so a migration can be reverted and applied again without
 * destroying either transition.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<({ id: number, existed: boolean, ownedRef: string } & Record<string, unknown>) | undefined>}
 */
async function getActiveApplyAudit(queryRunner) {
  await queryRunner.query(
    `INSERT INTO "migration_audit_lock" ("migration") VALUES ($1) ON CONFLICT ("migration") DO NOTHING`,
    Array.of(AUDIT_MIGRATION),
  );
  await queryRunner.query(`SELECT "migration" FROM "migration_audit_lock" WHERE "migration" = $1 FOR UPDATE`, [
    AUDIT_MIGRATION,
  ]);

  const rows = await queryRunner.query(
    `SELECT "id", "eventType", "applyEventId", "payload" FROM "migration_audit_event"
     WHERE "migration" = $1
     ORDER BY "id" FOR UPDATE`,
    Array.of(AUDIT_MIGRATION),
  );

  const applies = [];
  const rolledBackApplyIds = new Set();

  for (const row of rows) {
    const logId = Number(row.id);
    if (!Number.isSafeInteger(logId) || logId <= 0) {
      throw new Error(`Invalid audit event id '${row.id}' for ${AUDIT_MIGRATION}`);
    }

    let event;
    try {
      event = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    } catch {
      throw new Error(`Corrupt audit event ${row.id} for ${AUDIT_MIGRATION}`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Invalid audit payload ${row.id} for ${AUDIT_MIGRATION}`);
    }

    if (row.eventType === 'Apply') {
      if (
        event.action !== APPLY_ACTION ||
        event.settingKey !== REF_SETTING_KEY ||
        typeof event.existed !== 'boolean' ||
        (event.previous !== null && typeof event.previous !== 'string') ||
        typeof event.next !== 'string' ||
        typeof event.ownedRef !== 'string' ||
        !REF_CODE_FORMAT.test(event.ownedRef)
      ) {
        throw new Error(`Invalid apply audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      applies.push({ ...event, id: logId });
    } else if (row.eventType === 'Rollback') {
      const applyEventId = Number(row.applyEventId);
      if (
        event.action !== ROLLBACK_ACTION ||
        !Number.isSafeInteger(applyEventId) ||
        applyEventId <= 0 ||
        Number(event.applyLogId) !== applyEventId
      ) {
        throw new Error(`Invalid rollback audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      rolledBackApplyIds.add(applyEventId);
    } else {
      throw new Error(`Invalid audit event type '${row.eventType}' for ${AUDIT_MIGRATION}`);
    }
  }

  const activeApplies = applies.filter((event) => !rolledBackApplyIds.has(event.id));
  if (activeApplies.length > 1) {
    throw new Error(`Ambiguous audit state for ${AUDIT_MIGRATION}: ${activeApplies.length} active apply events`);
  }

  return activeApplies.at(0);
}

/**
 * @param {QueryRunner} queryRunner
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
async function writeAuditEvent(queryRunner, event) {
  const isApply = event.action === APPLY_ACTION;
  const isRollback = event.action === ROLLBACK_ACTION;
  if (!isApply && !isRollback) throw new Error(`Invalid audit action for ${AUDIT_MIGRATION}`);

  await queryRunner.query(
    `INSERT INTO "migration_audit_event" ("migration", "eventType", "applyEventId", "payload")
     VALUES ($1, $2, $3, $4::jsonb)`,
    [AUDIT_MIGRATION, isApply ? 'Apply' : 'Rollback', isRollback ? event.applyLogId : null, JSON.stringify(event)],
  );
}

/**
 * Resolve the Denario referral code from the pinned Denario organization account.
 *
 * The account is pinned by its immutable prod `user_data.id` (this migration is prd-only, see up()).
 * The referral CODE itself is still read live from that account rather than hardcoded, so a code
 * rotation needs no source change. The `accountType` filter is defense-in-depth: if the pinned id is
 * not an organization, the migration fails loud instead of routing to a wrong ref.
 *
 * The status filters intentionally do NOT require 'Active'. The referral system itself (see
 * UserService.checkRef/getRefUser) only requires that a user with the given ref exists and is not a
 * self-ref — it never checks user_data.status or user.status. Requiring 'Active' here would be
 * stricter than that semantics and would exclude the account's normal post-onboarding state: a
 * KycOnly user_data is flipped to 'NA' on the first wallet login (user creation), and the ref is
 * granted right away once kycLevel >= 50 — so a freshly onboarded partner sits at
 * user_data.status = 'NA', not 'Active'. Excluding only the terminal/unusable states (Blocked, Merged,
 * Deactivated for user_data; Blocked, Deleted for user) mirrors what the ref system actually accepts.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<string>}
 */
async function resolveDenarioRef(queryRunner) {
  const rows = await queryRunner.query(
    `
      SELECT DISTINCT u."ref" AS "ref"
      FROM "user" u
      INNER JOIN "user_data" ud ON ud."id" = u."userDataId"
      WHERE ud."id" = $1
        AND ud."accountType" = 'Organization'
        AND ud."status" NOT IN ('Blocked', 'Merged', 'Deactivated')
        AND u."status" NOT IN ('Blocked', 'Deleted')
        AND u."ref" IS NOT NULL
      ORDER BY u."ref"
    `,
    Array.of(DENARIO_USER_DATA_ID),
  );

  const refs = rows.map((row) => row.ref);
  if (refs.length === 0) {
    throw new Error(
      `No usable referral code found for the Denario organization account (user_data.id ${DENARIO_USER_DATA_ID}). ` +
        'Confirm the account has a non-blocked/non-deleted user with a referral code before running the migration.',
    );
  }
  if (refs.length > 1) {
    throw new Error(`Denario referral target is ambiguous: found ${refs.length} usable referral codes`);
  }
  const denarioRef = refs.at(0);
  if (!REF_CODE_FORMAT.test(denarioRef)) {
    throw new Error(`Denario account has an invalid referral code: '${denarioRef}'`);
  }

  return denarioRef;
}

/**
 * Adds the permanent `denario` alias to the environment-local `ref-keys` setting.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddDenarioPermanentRef1784994100000 {
  name = 'AddDenarioPermanentRef1784994100000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Partner-onboarding migration: NEVER run on dev/loc/CI — no Denario organization account exists
    // there at all, so resolveDenarioRef() below would throw and block boot. Returning early still
    // records the migration as executed, the intended no-op on lower environments (same rationale as
    // AddBankFrickCustodyAssets / ActivateBankFrick).
    if (process.env.ENVIRONMENT !== 'prd') return;

    // Serialize apply/reapply/rollback before taking the mutable setting lock. This keeps lock ordering
    // identical to down() and prevents a recovery reapply from creating a second active ownership event.
    const activeApply = await getActiveApplyAudit(queryRunner);
    const denarioRef = activeApply?.ownedRef ?? (await resolveDenarioRef(queryRunner));
    const row = (
      await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = $1 FOR UPDATE`, Array.of(REF_SETTING_KEY))
    ).at(0);
    const refKeys = parseRefKeys(row);

    if (activeApply) {
      if (Reflect.get(refKeys, DENARIO_ALIAS) === activeApply.ownedRef) return;
      throw new Error(
        `Active ${AUDIT_MIGRATION} ownership event no longer matches the '${DENARIO_ALIAS}' alias; ` +
          'run the ownership-safe rollback before reapplying',
      );
    }

    if (Object.prototype.hasOwnProperty.call(refKeys, DENARIO_ALIAS)) {
      if (Reflect.get(refKeys, DENARIO_ALIAS) === denarioRef) return;
      throw new Error(
        `Setting '${REF_SETTING_KEY}' already contains a conflicting '${DENARIO_ALIAS}' alias; refusing to overwrite it`,
      );
    }

    Reflect.set(refKeys, DENARIO_ALIAS, denarioRef);
    const value = JSON.stringify(refKeys);

    // The append-only before -> after event is written before the mutable snapshot. Migration execution
    // is transactional, so either both writes commit or neither does. The event deliberately survives down().
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      settingKey: REF_SETTING_KEY,
      existed: row != null,
      previous: row ? row.value : null,
      next: value,
      ownedRef: denarioRef,
    });

    if (row) {
      await queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = $2`, [
        value,
        REF_SETTING_KEY,
      ]);
    } else {
      await queryRunner.query(
        `INSERT INTO "setting" ("key", "value", "created", "updated") VALUES ($1, $2, NOW(), NOW())`,
        [REF_SETTING_KEY, value],
      );
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Mirror up(): the apply only ran on prd, so the rollback is a no-op everywhere else.
    if (process.env.ENVIRONMENT !== 'prd') return;

    const applyAudit = await getActiveApplyAudit(queryRunner);
    if (!applyAudit) return;

    const row = (
      await queryRunner.query(`SELECT "value" FROM "setting" WHERE "key" = $1 FOR UPDATE`, Array.of(REF_SETTING_KEY))
    ).at(0);

    let next = row?.value ?? null;
    let outcome = 'skippedSettingMissing';

    if (row) {
      const refKeys = parseRefKeys(row);
      // Only remove the alias while it still carries the value we set — an admin may have re-pointed or
      // re-added it after deployment; that later change is not ours to destroy.
      if (Reflect.get(refKeys, DENARIO_ALIAS) === applyAudit.ownedRef) {
        Reflect.deleteProperty(refKeys, DENARIO_ALIAS);
        next = Object.keys(refKeys).length === 0 && !applyAudit.existed ? null : JSON.stringify(refKeys);
        outcome = 'reverted';
      } else {
        outcome = Object.prototype.hasOwnProperty.call(refKeys, DENARIO_ALIAS)
          ? 'skippedAliasRepointed'
          : 'skippedAliasMissing';
      }
    }

    // Record the rollback decision and its exact before -> after state before touching the snapshot.
    // Even a skipped rollback remains reconstructible and the original apply event is never deleted.
    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      settingKey: REF_SETTING_KEY,
      previous: row?.value ?? null,
      next,
      outcome,
      ownedRef: applyAudit.ownedRef,
    });

    if (outcome !== 'reverted') return;

    if (next == null) {
      await queryRunner.query(`DELETE FROM "setting" WHERE "key" = $1`, Array.of(REF_SETTING_KEY));
    } else {
      await queryRunner.query(`UPDATE "setting" SET "value" = $1, "updated" = NOW() WHERE "key" = $2`, [
        next,
        REF_SETTING_KEY,
      ]);
    }
  }
};
