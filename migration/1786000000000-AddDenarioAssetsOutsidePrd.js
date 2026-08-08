// Close the non-prd gap left by AddDenarioWalletAndAssets1785600200000.
//
// That migration inserts DGC/DSC only when ENVIRONMENT === 'prd' and documents that lower
// environments obtain them from migration/seed/asset.csv. That assumption holds only for LOC:
// runSeed() runs exclusively for Environment.LOC, and seed.js aborts outside loc/local. On
// dev/CI the original migration is a recorded no-op and the seed never runs, so Polygon/DGC and
// Polygon/DSC never appear.
//
// This migration inserts only those two inert list-only assets outside prd. The Denario partner
// wallet and the permanent referral alias stay prd-only (owned by the original migrations).
//
// Assets (Polygon ERC-20, same values as the prd insert in AddDenarioWalletAndAssets):
// - DGC  Denario Gold Coin    0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f  decimals 8
// - DSC  Denario Silver Coin  0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7  decimals 8
// Both remain inert: no priceRuleId (hourly price job skips them) and every trade/payment flag
// false (isActive=false). financialType stays null.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const { isDeepStrictEqual } = require('node:util');

const AUDIT_MIGRATION = 'AddDenarioAssetsOutsidePrd1786000000000';
const APPLY_ACTION = 'applyDenarioAssetsOutsidePrd';
const ROLLBACK_ACTION = 'rollbackDenarioAssetsOutsidePrd';
// Transaction-scoped advisory lock key: this migration's timestamp. Unique across migrations by naming
// convention and outside hashtext()'s 32-bit range (see AddSavingZchfAsset / AddBinanceCustodyAssetsOndoAda).
const ADVISORY_LOCK_KEY = 1786000000000;
const EXPECTED_ASSETS = [
  {
    name: 'DGC',
    uniqueName: 'Polygon/DGC',
    type: 'Token',
    blockchain: 'Polygon',
    category: 'Public',
    dexName: 'DGC',
    chainId: '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f',
    decimals: 8,
    description: 'Denario Gold Coin',
    buyable: false,
    sellable: false,
    cardBuyable: false,
    cardSellable: false,
    instantBuyable: false,
    instantSellable: false,
    paymentEnabled: false,
    refEnabled: false,
    refundEnabled: true,
    ikna: false,
    personalIbanEnabled: false,
    comingSoon: false,
    priceRuleId: null,
  },
  {
    name: 'DSC',
    uniqueName: 'Polygon/DSC',
    type: 'Token',
    blockchain: 'Polygon',
    category: 'Public',
    dexName: 'DSC',
    chainId: '0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7',
    decimals: 8,
    description: 'Denario Silver Coin',
    buyable: false,
    sellable: false,
    cardBuyable: false,
    cardSellable: false,
    instantBuyable: false,
    instantSellable: false,
    paymentEnabled: false,
    refEnabled: false,
    refundEnabled: true,
    ikna: false,
    personalIbanEnabled: false,
    comingSoon: false,
    priceRuleId: null,
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
 * Accept a pre-existing asset only when it is exactly the inert token this migration intends to add.
 * A matching name alone must never hide a conflicting contract or an accidentally active asset.
 *
 * @param {QueryRunner} queryRunner
 * @param {Record<string, unknown>} expected
 * @returns {Promise<boolean>}
 */
async function assertExistingAssetIsExpected(queryRunner, expected) {
  const rows = await queryRunner.query(`SELECT * FROM "asset" WHERE "uniqueName" = $1 FOR UPDATE`, [
    expected.uniqueName,
  ]);
  if (rows.length > 1) throw new Error(`Asset '${expected.uniqueName}' is ambiguous: found ${rows.length} rows`);
  if (rows.length === 0) return false;

  const existing = normalizeRow(rows.at(0));
  const mismatches = Object.entries(expected)
    .filter(([key, value]) => !isDeepStrictEqual(Reflect.get(existing, key), value))
    .map((entry) => entry.at(0));
  if (mismatches.length > 0) {
    throw new Error(
      `Asset '${expected.uniqueName}' conflicts with the inert Denario definition in: ${mismatches.join(', ')}`,
    );
  }

  return true;
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
      if (!Array.isArray(event.createdAssets)) {
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
 * Load an owned row by its exact id and fail closed if anything has changed since this migration
 * created it. Missing rows are already absent and therefore need no destructive rollback action.
 *
 * @param {QueryRunner} queryRunner
 * @param {Record<string, unknown>} snapshot
 * @returns {Promise<boolean>}
 */
async function assertOwnedAssetIsUnchanged(queryRunner, snapshot) {
  const id = Number(snapshot?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid asset ownership snapshot in ${AUDIT_MIGRATION}`);
  }

  const current = (await queryRunner.query(`SELECT * FROM "asset" WHERE "id" = $1 FOR UPDATE`, Array.of(id))).at(0);
  if (!current) return false;

  if (!isDeepStrictEqual(normalizeRow(current), snapshot)) {
    throw new Error(`asset row ${id} changed since creation; refusing destructive rollback`);
  }

  return true;
}

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddDenarioAssetsOutsidePrd1786000000000 {
  name = 'AddDenarioAssetsOutsidePrd1786000000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // prd already has Polygon/DGC and Polygon/DSC from AddDenarioWalletAndAssets1785600200000.
    // This migration only closes the dev/CI gap created by that migration's !== 'prd' guard and the
    // incorrect assumption that seed/asset.csv would supply the rows outside LOC. LOC still gets
    // them from seed (ids 415/416) and typically does not run migrations (SQL_MIGRATE=false).
    if (process.env.ENVIRONMENT === 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // TypeORM can call a migration object more than once in tests or recovery tooling. An unmatched apply
    // event proves this migration already owns its exact inserts, so a repeated up() is a safe no-op.
    if (await getActiveApplyAudit(queryRunner)) return;

    const [dgcExpected, dscExpected] = EXPECTED_ASSETS;
    const dgcExists = await assertExistingAssetIsExpected(queryRunner, dgcExpected);
    const dscExists = await assertExistingAssetIsExpected(queryRunner, dscExpected);

    // Inert, list-only assets — existing rows were fully validated above; ids remain environment-specific.
    const createdDgc = dgcExists
      ? undefined
      : (
          await queryRunner.query(
            `INSERT INTO "asset"
           ("name", "uniqueName", "type", "blockchain", "category", "dexName", "chainId", "decimals", "description",
            "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
            "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon")
         VALUES ('DGC', 'Polygon/DGC', 'Token', 'Polygon', 'Public', 'DGC', '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f', 8, 'Denario Gold Coin',
            false, false, false, false, false, false,
            false, false, true, false, false, false)
         RETURNING *`,
          )
        ).at(0);

    const createdDsc = dscExists
      ? undefined
      : (
          await queryRunner.query(
            `INSERT INTO "asset"
           ("name", "uniqueName", "type", "blockchain", "category", "dexName", "chainId", "decimals", "description",
            "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
            "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon")
         VALUES ('DSC', 'Polygon/DSC', 'Token', 'Polygon', 'Public', 'DSC', '0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7', 8, 'Denario Silver Coin',
            false, false, false, false, false, false,
            false, false, true, false, false, false)
         RETURNING *`,
          )
        ).at(0);

    // Persist exact IDs and complete created-row snapshots after the inserts (ownership needs those
    // RETURNING rows). Pre-existing matching rows are intentionally absent from this event and can
    // therefore never be deleted by down(). Migration execution is transactional, so the inserts and
    // their ownership event commit together or not at all.
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      createdAssets: [createdDgc, createdDsc].filter(Boolean).map(normalizeRow),
    });
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

    const createdAssets = applyAudit.createdAssets;
    if (!Array.isArray(createdAssets)) {
      throw new Error(`Invalid asset ownership audit in ${AUDIT_MIGRATION}`);
    }

    const assetsToDelete = [];
    for (const snapshot of createdAssets) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error(`Invalid asset ownership snapshot in ${AUDIT_MIGRATION}`);
      }
      if (await assertOwnedAssetIsUnchanged(queryRunner, snapshot)) assetsToDelete.push(Number(snapshot.id));
    }

    // Record exactly what this rollback is about to delete before the destructive writes. The append-only
    // apply and rollback events survive the revert and make every ownership decision reconstructible.
    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      deletedAssetIds: assetsToDelete,
    });

    for (const id of assetsToDelete) {
      await queryRunner.query(`DELETE FROM "asset" WHERE "id" = $1`, Array.of(id));
    }
  }
};
