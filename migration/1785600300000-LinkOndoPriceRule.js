/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const ONDO_UNIQUE_NAME = 'Ethereum/ONDO';
const AUDIT_MIGRATION = 'LinkOndoPriceRule1785600300000';
const APPLY_ACTION = 'applyOndoPriceRule';
const ROLLBACK_ACTION = 'rollbackOndoPriceRule';
// Transaction-scoped advisory lock key: this migration's timestamp. Unique across migrations by naming
// convention and outside hashtext()'s 32-bit range (see AddSavingZchfAsset / AddBinanceCustodyAssetsOndoAda).
const ADVISORY_LOCK_KEY = 1785600300000;

/**
 * Return the single apply event that has not yet been matched by a rollback event.
 * Audit rows live in the append-only "log" table; pairing is pure application logic via action and
 * applyLogId in the JSON message payload.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<({ id: number, assetId: number, nextPriceRuleId: number } & Record<string, unknown>) | undefined>}
 */
async function getActiveApplyAudit(queryRunner) {
  // Serialize concurrent apply/reapply/rollback of this migration within the transaction.
  await queryRunner.query(`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`);

  const rows = await queryRunner.query(
    `SELECT "id", "message" FROM "log"
     WHERE "system" = 'Migration' AND "subsystem" = $1
     ORDER BY "id"`,
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
      event = typeof row.message === 'string' ? JSON.parse(row.message) : row.message;
    } catch {
      throw new Error(`Corrupt audit event ${logId} for ${AUDIT_MIGRATION}`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Invalid audit payload ${logId} for ${AUDIT_MIGRATION}`);
    }

    if (event.action === APPLY_ACTION) {
      const assetId = Number(event.assetId);
      const nextPriceRuleId = Number(event.nextPriceRuleId);
      if (
        event.uniqueName !== ONDO_UNIQUE_NAME ||
        event.previousPriceRuleId !== null ||
        !Number.isSafeInteger(assetId) ||
        assetId <= 0 ||
        !Number.isSafeInteger(nextPriceRuleId) ||
        nextPriceRuleId <= 0
      ) {
        throw new Error(`Invalid apply audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      applies.push({ ...event, id: logId, assetId, nextPriceRuleId });
    } else if (event.action === ROLLBACK_ACTION) {
      const applyLogId = Number(event.applyLogId);
      if (!Number.isSafeInteger(applyLogId) || applyLogId <= 0) {
        throw new Error(`Invalid rollback audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      rolledBackApplyIds.add(applyLogId);
    } else {
      throw new Error(`Invalid audit action '${event.action}' for ${AUDIT_MIGRATION}`);
    }
  }

  const activeApplies = applies.filter((event) => !rolledBackApplyIds.has(event.id));
  if (activeApplies.length > 1) {
    throw new Error(`Ambiguous audit state for ${AUDIT_MIGRATION}: ${activeApplies.length} active apply events`);
  }

  return activeApplies.at(0);
}

/**
 * Append an audit event to "log" and fail closed if the insert does not return an id.
 *
 * @param {QueryRunner} queryRunner
 * @param {Record<string, unknown>} event
 * @returns {Promise<void>}
 */
async function writeAuditEvent(queryRunner, event) {
  const isApply = event.action === APPLY_ACTION;
  const isRollback = event.action === ROLLBACK_ACTION;
  if (!isApply && !isRollback) throw new Error(`Invalid audit action for ${AUDIT_MIGRATION}`);

  const inserted = await queryRunner.query(
    `INSERT INTO "log" ("created", "updated", "system", "subsystem", "severity", "message")
     VALUES (NOW(), NOW(), 'Migration', $1, 'Info', $2)
     RETURNING "id"`,
    [AUDIT_MIGRATION, JSON.stringify(event)],
  );
  const logId = Number(inserted?.at?.(0)?.id);
  if (!Number.isSafeInteger(logId) || logId <= 0) {
    throw new Error(`Failed to write audit event for ${AUDIT_MIGRATION}`);
  }
}

/**
 * Resolve the environment-local rule by its semantic identity instead of assuming that seed id 60
 * is stable outside local development.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<number>}
 */
async function resolveOndoPriceRuleId(queryRunner) {
  const rows = await queryRunner.query(
    `SELECT "id" FROM "price_rule"
     WHERE "priceSource" = 'CoinGecko'
       AND "priceAsset" = 'ondo-finance'
       AND "priceReference" = 'tether'
     ORDER BY "id" FOR UPDATE`,
  );

  if (rows.length !== 1) {
    throw new Error(`Expected exactly one ONDO price rule, found ${rows.length}`);
  }

  const id = Number(rows.at(0).id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error(`Invalid ONDO price rule id '${rows.at(0).id}'`);
  return id;
}

/**
 * Links the existing active ONDO asset to its existing semantic price rule. This is required because
 * generic pay-in register strategies intentionally reject unpriced assets before creating processable inputs.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LinkOndoPriceRule1785600300000 {
  name = 'LinkOndoPriceRule1785600300000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Partner-onboarding migration: NEVER run on dev/loc/CI — there the ONDO price rule may be absent
    // (resolveOndoPriceRuleId below would throw and block boot) and ONDO is already priced via seed.
    // Returning early still records the migration as executed, the intended no-op on lower environments
    // (same rationale as AddBankFrickCustodyAssets).
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    if (await getActiveApplyAudit(queryRunner)) return;

    const assets = await queryRunner.query(
      `SELECT "id", "priceRuleId" FROM "asset" WHERE "uniqueName" = $1 FOR UPDATE`,
      Array.of(ONDO_UNIQUE_NAME),
    );
    if (assets.length === 0) throw new Error(`Required ONDO asset '${ONDO_UNIQUE_NAME}' was not found`);
    if (assets.length > 1) throw new Error(`ONDO asset is ambiguous: found ${assets.length} matching rows`);

    const assetId = Number(assets.at(0).id);
    if (!Number.isSafeInteger(assetId) || assetId <= 0) throw new Error(`Invalid ONDO asset id '${assets.at(0).id}'`);

    const priceRuleId = await resolveOndoPriceRuleId(queryRunner);
    const currentPriceRuleId = assets.at(0).priceRuleId == null ? null : Number(assets.at(0).priceRuleId);
    if (currentPriceRuleId != null) {
      if (currentPriceRuleId === priceRuleId) return;
      throw new Error(
        `ONDO already references price rule ${currentPriceRuleId}, expected semantic rule ${priceRuleId}; refusing overwrite`,
      );
    }

    // Fail-closed: persist the exact before -> after transition and require a returned id before
    // changing the mutable asset snapshot.
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      assetId,
      uniqueName: ONDO_UNIQUE_NAME,
      previousPriceRuleId: null,
      nextPriceRuleId: priceRuleId,
    });

    await queryRunner.query(
      `UPDATE "asset" SET "priceRuleId" = $1, "updated" = NOW()
       WHERE "id" = $2 AND "priceRuleId" IS NULL`,
      [priceRuleId, assetId],
    );
    const after = (await queryRunner.query(`SELECT "priceRuleId" FROM "asset" WHERE "id" = $1`, Array.of(assetId))).at(
      0,
    );
    if (Number(after?.priceRuleId) !== priceRuleId) {
      throw new Error('ONDO price-rule assignment changed concurrently; migration aborted');
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Mirror up(): the apply only ran on prd, so the rollback is a no-op everywhere else.
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    const applyAudit = await getActiveApplyAudit(queryRunner);
    if (!applyAudit) return;

    const asset = (
      await queryRunner.query(`SELECT "uniqueName", "priceRuleId" FROM "asset" WHERE "id" = $1 FOR UPDATE`, [
        applyAudit.assetId,
      ])
    ).at(0);
    const currentPriceRuleId = asset?.priceRuleId == null ? null : Number(asset.priceRuleId);

    let outcome = 'skippedAssetMissing';
    let nextPriceRuleId = currentPriceRuleId;
    if (asset) {
      if (asset.uniqueName !== ONDO_UNIQUE_NAME) {
        outcome = 'skippedAssetIdentityChanged';
      } else if (currentPriceRuleId === applyAudit.nextPriceRuleId) {
        outcome = 'reverted';
        nextPriceRuleId = null;
      } else {
        outcome = 'skippedPriceRuleChanged';
      }
    }

    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      assetId: applyAudit.assetId,
      expectedUniqueName: ONDO_UNIQUE_NAME,
      currentUniqueName: asset?.uniqueName ?? null,
      previousPriceRuleId: currentPriceRuleId,
      nextPriceRuleId,
      outcome,
    });

    if (outcome !== 'reverted') return;

    await queryRunner.query(
      `UPDATE "asset" SET "priceRuleId" = NULL, "updated" = NOW()
       WHERE "id" = $1 AND "uniqueName" = $2 AND "priceRuleId" = $3`,
      [applyAudit.assetId, ONDO_UNIQUE_NAME, applyAudit.nextPriceRuleId],
    );
    const after = (
      await queryRunner.query(`SELECT "uniqueName", "priceRuleId" FROM "asset" WHERE "id" = $1`, [applyAudit.assetId])
    ).at(0);
    if (!after || after.uniqueName !== ONDO_UNIQUE_NAME || after.priceRuleId != null) {
      throw new Error('ONDO price-rule rollback changed concurrently; migration aborted');
    }
  }
};
