// Link Polygon/DGC and Polygon/DSC to Denario price rules outside prd only.
//
// Companion to AddDenarioAssetsOutsidePrd1786000000000 (inserts inert assets outside prd) and
// EnableDenarioAssetsOutsidePrd1786200000000 (sets buyable/sellable outside prd only).
//
// This migration is intentionally separate from enablement so price rules and tradability can be
// rolled back independently. Buyable/sellable are not touched here.
//
// Outside prd only:
// 1. Insert one Denario price_rule per token (live partner premium via PricingDenarioService).
// 2. Point asset.priceRuleId at those rules.
//
// prd is a deliberate no-op. AssetService.getPayInAssets filters on priceRule IS NOT NULL: assigning
// a price rule on prod would admit DGC/DSC into pay-in registration (unpriced tokens today end as
// terminal FAILED with a monitoring alert). Leaving them unpriced on prd keeps that safety filter.
// A later prod activation needs its own deliberate migration.
//
// Price source is PriceSource.DENARIO ('Denario'). priceAsset is DGC/DSC, priceReference is USD;
// referenceId is resolved dynamically via uniqueName = 'Ethereum/USDT' (seed id 123 is not stable).

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const { isDeepStrictEqual } = require('node:util');

const AUDIT_MIGRATION = 'LinkDenarioPriceRules1786100000000';
const APPLY_ACTION = 'applyLinkDenarioPriceRules';
const ROLLBACK_ACTION = 'rollbackLinkDenarioPriceRules';
// Transaction-scoped advisory lock key: this migration's timestamp. Unique across migrations by naming
// convention and outside hashtext()'s 32-bit range (see AddSavingZchfAsset / AddBinanceCustodyAssetsOndoAda).
const ADVISORY_LOCK_KEY = 1786100000000;

const USDT_UNIQUE_NAME = 'Ethereum/USDT';
const PRICE_VALIDITY_SECONDS = 300;

// PriceSource.DENARIO — live partner premium; see PricingDenarioService.
const DENARIO_PRICE_SOURCE = 'Denario';

const TARGET_ASSETS = [
  {
    uniqueName: 'Polygon/DGC',
    priceAsset: 'DGC',
    priceSource: DENARIO_PRICE_SOURCE,
  },
  {
    uniqueName: 'Polygon/DSC',
    priceAsset: 'DSC',
    priceSource: DENARIO_PRICE_SOURCE,
  },
];

/**
 * Convert driver-specific values such as Date objects into the JSON representation persisted
 * in the audit event.
 *
 * @param {Record<string, unknown>} row
 * @returns {Record<string, unknown>}
 */
function normalizeRow(row) {
  return JSON.parse(JSON.stringify(row));
}

/**
 * Return the single apply event that has not yet been matched by a rollback event.
 * Audit rows live in the append-only "log" table; pairing is pure application logic via action and
 * applyLogId in the JSON message payload.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<({ id: number } & Record<string, unknown>) | undefined>}
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
      if (!Array.isArray(event.assets) || !Array.isArray(event.createdPriceRules)) {
        throw new Error(`Invalid apply audit event ${logId} for ${AUDIT_MIGRATION}`);
      }
      applies.push({ ...event, id: logId });
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
 * Resolve Ethereum/USDT by uniqueName. Seed id 123 is not stable across environments.
 *
 * @param {QueryRunner} queryRunner
 * @returns {Promise<number>}
 */
async function resolveUsdtReferenceId(queryRunner) {
  const rows = await queryRunner.query(
    `SELECT "id" FROM "asset" WHERE "uniqueName" = $1 ORDER BY "id" FOR UPDATE`,
    Array.of(USDT_UNIQUE_NAME),
  );
  if (rows.length === 0) {
    throw new Error(`Required reference asset '${USDT_UNIQUE_NAME}' was not found`);
  }
  if (rows.length > 1) {
    throw new Error(`Reference asset '${USDT_UNIQUE_NAME}' is ambiguous: found ${rows.length} rows`);
  }

  const id = Number(rows.at(0).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid reference asset id '${rows.at(0).id}' for ${USDT_UNIQUE_NAME}`);
  }
  return id;
}

/**
 * Load a single Denario asset and refuse foreign price rules.
 *
 * @param {QueryRunner} queryRunner
 * @param {string} uniqueName
 * @returns {Promise<{ id: number, priceRuleId: number | null }>}
 */
async function loadTargetAsset(queryRunner, uniqueName) {
  const rows = await queryRunner.query(
    `SELECT "id", "priceRuleId" FROM "asset" WHERE "uniqueName" = $1 FOR UPDATE`,
    Array.of(uniqueName),
  );
  if (rows.length === 0) {
    throw new Error(`Required Denario asset '${uniqueName}' was not found`);
  }
  if (rows.length > 1) {
    throw new Error(`Denario asset '${uniqueName}' is ambiguous: found ${rows.length} rows`);
  }

  const row = rows.at(0);
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid asset id '${row.id}' for '${uniqueName}'`);
  }

  const priceRuleId = row.priceRuleId == null ? null : Number(row.priceRuleId);
  if (priceRuleId != null && (!Number.isSafeInteger(priceRuleId) || priceRuleId <= 0)) {
    throw new Error(`Invalid priceRuleId '${row.priceRuleId}' on '${uniqueName}'`);
  }

  return {
    id,
    priceRuleId,
  };
}

/**
 * Load an owned price_rule by exact id and fail closed if anything has changed since creation.
 * Missing rows are already absent and therefore need no destructive rollback action.
 *
 * @param {QueryRunner} queryRunner
 * @param {Record<string, unknown>} snapshot
 * @returns {Promise<boolean>}
 */
async function assertOwnedPriceRuleIsUnchanged(queryRunner, snapshot) {
  const id = Number(snapshot?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid price_rule ownership snapshot in ${AUDIT_MIGRATION}`);
  }

  const current = (await queryRunner.query(`SELECT * FROM "price_rule" WHERE "id" = $1 FOR UPDATE`, Array.of(id))).at(
    0,
  );
  if (!current) return false;

  if (!isDeepStrictEqual(normalizeRow(current), snapshot)) {
    throw new Error(`price_rule row ${id} changed since creation; refusing destructive rollback`);
  }

  return true;
}

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class LinkDenarioPriceRules1786100000000 {
  name = 'LinkDenarioPriceRules1786100000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // prd deliberately keeps DGC/DSC unpriced so getPayInAssets continues to exclude them.
    // Pricing is exclusively a dev/CI surface until a later deliberate prd migration.
    if (process.env.ENVIRONMENT === 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // TypeORM can call a migration object more than once in tests or recovery tooling. An unmatched
    // apply event proves this migration already owns its exact inserts and asset updates.
    if (await getActiveApplyAudit(queryRunner)) return;

    const referenceId = await resolveUsdtReferenceId(queryRunner);

    // Validate every target before any insert so a missing second asset cannot leave a half-applied state
    // (production migrations are transactional; tests and recovery tooling may not be).
    // Written out instead of an indexed access type: the migration psql guard treats any
    // bracket-quoted identifier as MSSQL syntax, including one inside a JSDoc annotation.
    /** @type {{ target: { uniqueName: string, priceAsset: string, priceSource: string }, asset: { id: number, priceRuleId: number | null } }[]} */
    const prepared = [];
    for (const target of TARGET_ASSETS) {
      const asset = await loadTargetAsset(queryRunner, target.uniqueName);

      // Refuse overwrite of a foreign price rule (same fail-closed stance as LinkOndoPriceRule).
      if (asset.priceRuleId != null) {
        throw new Error(
          `Asset '${target.uniqueName}' already references price rule ${asset.priceRuleId}; refusing overwrite`,
        );
      }

      prepared.push({ target, asset });
    }

    /** @type {{ assetId: number, uniqueName: string, previousPriceRuleId: number | null, nextPriceRuleId: number }[]} */
    const assetTransitions = [];
    /** @type {Record<string, unknown>[]} */
    const createdPriceRules = [];

    for (const { target, asset } of prepared) {
      const created = (
        await queryRunner.query(
          `INSERT INTO "price_rule"
             ("priceSource", "priceAsset", "priceReference", "priceValiditySeconds", "referenceId")
           VALUES ($1, $2, 'USD', $3, $4)
           RETURNING *`,
          [target.priceSource, target.priceAsset, PRICE_VALIDITY_SECONDS, referenceId],
        )
      ).at(0);

      const nextPriceRuleId = Number(created?.id);
      if (!Number.isSafeInteger(nextPriceRuleId) || nextPriceRuleId <= 0) {
        throw new Error(`Failed to insert price_rule for '${target.uniqueName}'`);
      }

      createdPriceRules.push(normalizeRow(created));
      assetTransitions.push({
        assetId: asset.id,
        uniqueName: target.uniqueName,
        previousPriceRuleId: null,
        nextPriceRuleId,
      });
    }

    // Fail-closed: persist the exact before -> after transition before mutating assets.
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      referenceId,
      assets: assetTransitions,
      createdPriceRules,
    });

    for (const transition of assetTransitions) {
      await queryRunner.query(
        `UPDATE "asset"
         SET "priceRuleId" = $1, "updated" = NOW()
         WHERE "id" = $2 AND "uniqueName" = $3 AND "priceRuleId" IS NULL`,
        [transition.nextPriceRuleId, transition.assetId, transition.uniqueName],
      );

      const after = (
        await queryRunner.query(`SELECT "priceRuleId" FROM "asset" WHERE "id" = $1`, [transition.assetId])
      ).at(0);

      if (Number(after?.priceRuleId) !== transition.nextPriceRuleId) {
        throw new Error(`Asset '${transition.uniqueName}' price-rule link changed concurrently; migration aborted`);
      }
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Mirror up(): the apply only ran outside prd, so the rollback is a no-op on prd.
    if (process.env.ENVIRONMENT === 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    const applyAudit = await getActiveApplyAudit(queryRunner);
    if (!applyAudit) return;

    const assets = applyAudit.assets;
    const createdPriceRules = applyAudit.createdPriceRules;
    if (!Array.isArray(assets) || !Array.isArray(createdPriceRules)) {
      throw new Error(`Invalid ownership audit in ${AUDIT_MIGRATION}`);
    }

    // Verify owned price rules are still exactly as created before any destructive work.
    const rulesToDelete = [];
    for (const snapshot of createdPriceRules) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error(`Invalid price_rule ownership snapshot in ${AUDIT_MIGRATION}`);
      }
      if (await assertOwnedPriceRuleIsUnchanged(queryRunner, snapshot)) {
        rulesToDelete.push(Number(snapshot.id));
      }
    }

    // Verify assets still carry the state this migration applied; refuse partial silent rollback.
    for (const transition of assets) {
      const assetId = Number(transition?.assetId);
      if (!Number.isSafeInteger(assetId) || assetId <= 0) {
        throw new Error(`Invalid asset transition in ${AUDIT_MIGRATION}`);
      }

      const current = (
        await queryRunner.query(
          `SELECT "uniqueName", "priceRuleId" FROM "asset" WHERE "id" = $1 FOR UPDATE`,
          Array.of(assetId),
        )
      ).at(0);

      if (!current) {
        throw new Error(`Asset id ${assetId} missing during rollback of ${AUDIT_MIGRATION}`);
      }
      if (current.uniqueName !== transition.uniqueName) {
        throw new Error(
          `Asset id ${assetId} uniqueName changed ('${current.uniqueName}' vs '${transition.uniqueName}'); refusing rollback`,
        );
      }

      const currentPriceRuleId = current.priceRuleId == null ? null : Number(current.priceRuleId);
      if (currentPriceRuleId !== Number(transition.nextPriceRuleId)) {
        throw new Error(
          `Asset '${transition.uniqueName}' priceRuleId changed since apply (${currentPriceRuleId} vs ${transition.nextPriceRuleId}); refusing rollback`,
        );
      }
    }

    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      restoredAssets: assets.map((t) => ({
        assetId: t.assetId,
        uniqueName: t.uniqueName,
        previousPriceRuleId: t.nextPriceRuleId,
        nextPriceRuleId: t.previousPriceRuleId,
      })),
      deletedPriceRuleIds: rulesToDelete,
    });

    // Unlink assets before deleting price rules (FK asset.priceRuleId -> price_rule.id).
    for (const transition of assets) {
      await queryRunner.query(
        `UPDATE "asset"
         SET "priceRuleId" = $1, "updated" = NOW()
         WHERE "id" = $2 AND "uniqueName" = $3 AND "priceRuleId" = $4`,
        [transition.previousPriceRuleId, transition.assetId, transition.uniqueName, transition.nextPriceRuleId],
      );

      const after = (
        await queryRunner.query(`SELECT "priceRuleId" FROM "asset" WHERE "id" = $1`, [transition.assetId])
      ).at(0);

      const afterPriceRuleId = after?.priceRuleId == null ? null : Number(after.priceRuleId);
      const expectedPriceRuleId =
        transition.previousPriceRuleId == null ? null : Number(transition.previousPriceRuleId);
      if (afterPriceRuleId !== expectedPriceRuleId) {
        throw new Error(`Asset '${transition.uniqueName}' rollback changed concurrently; migration aborted`);
      }
    }

    for (const id of rulesToDelete) {
      await queryRunner.query(`DELETE FROM "price_rule" WHERE "id" = $1`, Array.of(id));
    }
  }
};
