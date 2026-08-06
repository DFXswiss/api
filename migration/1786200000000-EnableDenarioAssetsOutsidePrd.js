// Make Polygon/DGC and Polygon/DSC buyable and sellable outside prd.
//
// Companion to LinkDenarioPriceRules1786100000000, which creates and links Denario price rules in
// every environment (including prd). This migration only flips tradability flags and is intentionally
// separate so price rules can stay while buyability is rolled back (or vice versa).
//
// Outside prd only:
// 1. Require both assets to already carry a priceRuleId (set by LinkDenarioPriceRules).
// 2. Set asset.buyable = true and asset.sellable = true (bank-transfer path).
//
// All other flags stay false: cardBuyable, cardSellable, instantBuyable, instantSellable,
// paymentEnabled, refEnabled.
//
// prd is a deliberate no-op: production keeps the tokens non-tradable until a later deliberate
// enablement. Sell on prd must not go live until the pricing layer handles Ask/Bid direction
// (see PricingDenarioService TODO).
//
// Sell on non-prd deliberately uses the inverted Ask (one price_rule → Price.invert()). That is
// acceptable on dev/CI where no real money moves; resolve before sellable is true on prd.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const AUDIT_MIGRATION = 'EnableDenarioAssetsOutsidePrd1786200000000';
const APPLY_ACTION = 'applyEnableDenarioAssetsOutsidePrd';
const ROLLBACK_ACTION = 'rollbackEnableDenarioAssetsOutsidePrd';
// Transaction-scoped advisory lock key: this migration's timestamp. Unique across migrations by naming
// convention and outside hashtext()'s 32-bit range (see AddSavingZchfAsset / AddBinanceCustodyAssetsOndoAda).
const ADVISORY_LOCK_KEY = 1786200000000;

const TARGET_ASSETS = ['Polygon/DGC', 'Polygon/DSC'];

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
      if (!Array.isArray(event.assets)) {
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
 * Load a single Denario asset. Requires a priceRuleId — without a price the flags are meaningless.
 *
 * @param {QueryRunner} queryRunner
 * @param {string} uniqueName
 * @returns {Promise<{ id: number, priceRuleId: number, buyable: boolean, sellable: boolean }>}
 */
async function loadTargetAsset(queryRunner, uniqueName) {
  const rows = await queryRunner.query(
    `SELECT "id", "priceRuleId", "buyable", "sellable" FROM "asset" WHERE "uniqueName" = $1 FOR UPDATE`,
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

  if (row.priceRuleId == null) {
    throw new Error(`Asset '${uniqueName}' has no priceRuleId; LinkDenarioPriceRules must run first`);
  }

  const priceRuleId = Number(row.priceRuleId);
  if (!Number.isSafeInteger(priceRuleId) || priceRuleId <= 0) {
    throw new Error(`Invalid priceRuleId '${row.priceRuleId}' on '${uniqueName}'`);
  }

  return {
    id,
    priceRuleId,
    buyable: Boolean(row.buyable),
    sellable: Boolean(row.sellable),
  };
}

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class EnableDenarioAssetsOutsidePrd1786200000000 {
  name = 'EnableDenarioAssetsOutsidePrd1786200000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // prd deliberately keeps DGC/DSC non-tradable. This migration is exclusively a dev/CI test
    // surface so the Denario partner can exercise quote + payment-info flows.
    if (process.env.ENVIRONMENT === 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // TypeORM can call a migration object more than once in tests or recovery tooling. An unmatched
    // apply event proves this migration already owns its exact asset updates.
    if (await getActiveApplyAudit(queryRunner)) return;

    // Validate every target before any update so a missing second asset cannot leave a half-applied state.
    /** @type {{ uniqueName: string, asset: { id: number, priceRuleId: number, buyable: boolean, sellable: boolean } }[]} */
    const prepared = [];
    for (const uniqueName of TARGET_ASSETS) {
      const asset = await loadTargetAsset(queryRunner, uniqueName);
      prepared.push({ uniqueName, asset });
    }

    /** @type {{ assetId: number, uniqueName: string, previousBuyable: boolean, nextBuyable: boolean, previousSellable: boolean, nextSellable: boolean }[]} */
    const assetTransitions = prepared.map(({ uniqueName, asset }) => ({
      assetId: asset.id,
      uniqueName,
      previousBuyable: asset.buyable,
      nextBuyable: true,
      previousSellable: asset.sellable,
      nextSellable: true,
    }));

    // Fail-closed: persist the exact before -> after transition before mutating assets.
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      assets: assetTransitions,
    });

    for (const transition of assetTransitions) {
      // Only buyable and sellable — never touch card/instant/payment/ref flags.
      await queryRunner.query(
        `UPDATE "asset"
         SET "buyable" = true, "sellable" = true, "updated" = NOW()
         WHERE "id" = $1 AND "uniqueName" = $2`,
        [transition.assetId, transition.uniqueName],
      );

      const after = (
        await queryRunner.query(`SELECT "buyable", "sellable" FROM "asset" WHERE "id" = $1`, [transition.assetId])
      ).at(0);

      if (after?.buyable !== true || after?.sellable !== true) {
        throw new Error(`Asset '${transition.uniqueName}' enablement changed concurrently; migration aborted`);
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
    if (!Array.isArray(assets)) {
      throw new Error(`Invalid ownership audit in ${AUDIT_MIGRATION}`);
    }

    // Verify assets still carry the state this migration applied; refuse partial silent rollback.
    for (const transition of assets) {
      const assetId = Number(transition?.assetId);
      if (!Number.isSafeInteger(assetId) || assetId <= 0) {
        throw new Error(`Invalid asset transition in ${AUDIT_MIGRATION}`);
      }

      const current = (
        await queryRunner.query(
          `SELECT "uniqueName", "buyable", "sellable" FROM "asset" WHERE "id" = $1 FOR UPDATE`,
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
      if (Boolean(current.buyable) !== true || Boolean(current.sellable) !== true) {
        throw new Error(`Asset '${transition.uniqueName}' buyable/sellable changed since apply; refusing rollback`);
      }
    }

    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      restoredAssets: assets.map((t) => ({
        assetId: t.assetId,
        uniqueName: t.uniqueName,
        previousBuyable: t.nextBuyable,
        nextBuyable: t.previousBuyable,
        previousSellable: t.nextSellable,
        nextSellable: t.previousSellable,
      })),
    });

    for (const transition of assets) {
      await queryRunner.query(
        `UPDATE "asset"
         SET "buyable" = $1, "sellable" = $2, "updated" = NOW()
         WHERE "id" = $3 AND "uniqueName" = $4 AND "buyable" = true AND "sellable" = true`,
        [transition.previousBuyable, transition.previousSellable, transition.assetId, transition.uniqueName],
      );

      const after = (
        await queryRunner.query(`SELECT "buyable", "sellable" FROM "asset" WHERE "id" = $1`, [transition.assetId])
      ).at(0);

      if (
        Boolean(after?.buyable) !== Boolean(transition.previousBuyable) ||
        Boolean(after?.sellable) !== Boolean(transition.previousSellable)
      ) {
        throw new Error(`Asset '${transition.uniqueName}' rollback changed concurrently; migration aborted`);
      }
    }
  }
};
