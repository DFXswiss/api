/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const ONDO_UNIQUE_NAME = 'Ethereum/ONDO';
const AUDIT_MIGRATION = 'LinkOndoPriceRule1784039000000';
const APPLY_ACTION = 'applyOndoPriceRule';
const ROLLBACK_ACTION = 'rollbackOndoPriceRule';

/**
 * @param {QueryRunner} queryRunner
 * @returns {Promise<({ id: number, assetId: number, nextPriceRuleId: number } & Record<string, unknown>) | undefined>}
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
      throw new Error(`Corrupt audit event ${logId} for ${AUDIT_MIGRATION}`);
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error(`Invalid audit payload ${logId} for ${AUDIT_MIGRATION}`);
    }

    if (row.eventType === 'Apply') {
      const assetId = Number(event.assetId);
      const nextPriceRuleId = Number(event.nextPriceRuleId);
      if (
        event.action !== APPLY_ACTION ||
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
module.exports = class LinkOndoPriceRule1784039000000 {
  name = 'LinkOndoPriceRule1784039000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
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

    // Persist the exact before -> after transition before changing the mutable asset snapshot.
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
