// Onboard Denario: add the "Denario" partner wallet and its two Polygon precious-metal tokens.
//
// Wallet (partner table):
// - "Denario" is added analogously to existing partner wallets (e.g. Cake Wallet). Only name and
//   displayName are set; all compliance/behaviour columns take their conservative entity defaults
//   (isKycClient=false, autoTradeApproval=false, usesDummyAddresses=false, displayFraudWarning=false,
//   amlRules='0', buySpecificIbanEnabled=false). Adjust these once DFX confirms the partner's KYC/AML
//   setup — kept conservative on purpose so the partner cannot bypass any check by default.
//
// Assets (Polygon ERC-20, verified on-chain):
// - DGC  Denario Gold Coin    0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f  decimals 8
//   https://polygonscan.com/token/0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f
// - DSC  Denario Silver Coin  0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7  decimals 8
//   https://polygonscan.com/token/0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7
// Both are added as inert, list-only assets (like OlkyFrozen/EUR): no priceRuleId -> excluded from the
// hourly price job, and every trade/payment flag false -> isActive=false, so no cron/observable picks
// them up. There is no automatic liquidity-management mechanism to buy/sell these tokens; any purchase
// or sale is handled manually. financialType is intentionally left null (no precious-metal type exists
// yet) — set it when trading is enabled.

/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

const { isDeepStrictEqual } = require('node:util');

const AUDIT_MIGRATION = 'AddDenarioWalletAndAssets1785600200000';
const APPLY_ACTION = 'applyDenarioWalletAndAssets';
const ROLLBACK_ACTION = 'rollbackDenarioWalletAndAssets';
const DENARIO_WALLET_NAME_INDEX = 'IDX_8f34480ca127806f8393bd56fb';
const EXPECTED_WALLET = {
  address: null,
  name: 'Denario',
  displayName: 'Denario',
  isKycClient: false,
  displayFraudWarning: false,
  usesDummyAddresses: false,
  customKyc: null,
  identMethod: null,
  apiUrl: null,
  apiKey: null,
  amlRules: '0',
  exceptAmlRules: null,
  webhookConfig: null,
  mailConfig: null,
  autoTradeApproval: false,
  buySpecificIbanEnabled: false,
  ownerId: null,
};
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
 * A pre-existing row is safe to reuse only when it has the same conservative behavior as a row
 * created by this migration. In particular, an existing KYC client or auto-approved wallet must
 * not silently become the Denario integration merely because its display name matches.
 *
 * @param {Record<string, unknown>} existing
 */
function assertExistingWalletIsExpected(existing) {
  const normalized = normalizeRow(existing);
  const mismatches = Object.entries(EXPECTED_WALLET)
    .filter(([key, value]) => !isDeepStrictEqual(Reflect.get(normalized, key), value))
    .map((entry) => entry.at(0));
  if (mismatches.length > 0) {
    throw new Error(`Existing Denario wallet conflicts with the conservative definition in: ${mismatches.join(', ')}`);
  }
}

/**
 * @param {QueryRunner} queryRunner
 * @returns {Promise<({ id: number } & Record<string, unknown>) | undefined>}
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
        !Array.isArray(event.createdAssets) ||
        (event.createdWallet != null && (typeof event.createdWallet !== 'object' || Array.isArray(event.createdWallet)))
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
 * Load an owned row by its exact id and fail closed if anything has changed since this migration
 * created it. Missing rows are already absent and therefore need no destructive rollback action.
 *
 * @param {QueryRunner} queryRunner
 * @param {'asset' | 'wallet'} table
 * @param {Record<string, unknown>} snapshot
 * @returns {Promise<boolean>}
 */
async function assertOwnedRowIsUnchanged(queryRunner, table, snapshot) {
  const id = Number(snapshot?.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error(`Invalid ${table} ownership snapshot in ${AUDIT_MIGRATION}`);
  }

  const current = (await queryRunner.query(`SELECT * FROM "${table}" WHERE "id" = $1 FOR UPDATE`, Array.of(id))).at(0);
  if (!current) return false;

  if (!isDeepStrictEqual(normalizeRow(current), snapshot)) {
    throw new Error(`${table} row ${id} changed since creation; refusing destructive rollback`);
  }

  return true;
}

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddDenarioWalletAndAssets1785600200000 {
  name = 'AddDenarioWalletAndAssets1785600200000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Cheap, read-only precheck that runs in every environment before the index below: if duplicate
    // 'Denario' rows already exist, this fails with a clear application error instead of the opaque
    // constraint-violation error that CREATE UNIQUE INDEX would otherwise raise.
    const preExistingWallets = await queryRunner.query(
      `SELECT "id" FROM "wallet" WHERE "name" = 'Denario' ORDER BY "id"`,
    );
    if (preExistingWallets.length > 1) {
      throw new Error(`Denario wallet is ambiguous: found ${preExistingWallets.length} matching rows`);
    }

    // wallet.name is intentionally not globally unique, but the Wallet entity declares a single stable
    // Denario partner row via this partial unique index. It runs unconditionally in every environment
    // because it is declared entity schema, not partner-onboarding data: guarding it behind the prd-only
    // check below would leave it missing on every other environment, and the next `migration:generate`
    // would then emit it again as an ungated pending migration.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "${DENARIO_WALLET_NAME_INDEX}" ON "wallet" ("name") WHERE "name" = 'Denario'`,
    );

    // Partner-onboarding migration: NEVER run on dev/loc/CI — there the Denario wallet/assets come from
    // migration/seed/asset.csv (unlinked). Returning early still records the migration as executed, the
    // intended no-op on lower environments (same rationale as AddBankFrickCustodyAssets).
    if (process.env.ENVIRONMENT !== 'prd') return;

    // TypeORM can call a migration object more than once in tests or recovery tooling. An unmatched apply
    // event proves this migration already owns its exact inserts, so a repeated up() is a safe no-op.
    if (await getActiveApplyAudit(queryRunner)) return;

    // The partial unique index created above already closes the empty-result SELECT/INSERT race against
    // the admin wallet endpoint. Re-read under a row lock because an external insert may still have
    // committed between the preflight query and this point.
    const existingWallets = await queryRunner.query(
      `SELECT * FROM "wallet" WHERE "name" = 'Denario' ORDER BY "id" FOR UPDATE`,
    );
    if (existingWallets.length > 1) {
      throw new Error(`Denario wallet is ambiguous: found ${existingWallets.length} matching rows`);
    }
    if (existingWallets.length === 1) assertExistingWalletIsExpected(existingWallets.at(0));

    // Partner wallet — all other columns take their conservative DB defaults.
    const createdWallet = existingWallets.length
      ? undefined
      : (
          await queryRunner.query(
            `INSERT INTO "wallet" ("name", "displayName") VALUES ('Denario', 'Denario') RETURNING *`,
          )
        ).at(0);

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

    // Persist exact IDs and complete created-row snapshots. Pre-existing matching rows are intentionally
    // absent from this event and can therefore never be deleted by down(). Migration execution is
    // transactional, so the inserts and their ownership event commit together or not at all.
    await writeAuditEvent(queryRunner, {
      action: APPLY_ACTION,
      createdWallet: createdWallet ? normalizeRow(createdWallet) : null,
      createdAssets: [createdDgc, createdDsc].filter(Boolean).map(normalizeRow),
    });
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Mirror up(): the apply only ran on prd, so the rollback is a no-op everywhere else.
    if (process.env.ENVIRONMENT !== 'prd') return;

    const applyAudit = await getActiveApplyAudit(queryRunner);
    if (!applyAudit) return;

    // The partial unique index on "wallet" is declared entity schema (see up()), not data this migration
    // owns — it carries no data of its own and stays in place across a revert, the same as any other
    // structural index defined on the entity.
    const createdAssets = applyAudit.createdAssets;
    if (!Array.isArray(createdAssets)) {
      throw new Error(`Invalid asset ownership audit in ${AUDIT_MIGRATION}`);
    }

    const assetsToDelete = [];
    for (const snapshot of createdAssets) {
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error(`Invalid asset ownership snapshot in ${AUDIT_MIGRATION}`);
      }
      if (await assertOwnedRowIsUnchanged(queryRunner, 'asset', snapshot)) assetsToDelete.push(Number(snapshot.id));
    }

    const createdWallet = applyAudit.createdWallet;
    if (createdWallet != null && (typeof createdWallet !== 'object' || Array.isArray(createdWallet))) {
      throw new Error(`Invalid wallet ownership snapshot in ${AUDIT_MIGRATION}`);
    }

    let walletToDelete;
    if (createdWallet && (await assertOwnedRowIsUnchanged(queryRunner, 'wallet', createdWallet))) {
      walletToDelete = Number(createdWallet.id);
      const references = await queryRunner.query(
        `SELECT COUNT(*)::int AS "count" FROM "user" WHERE "walletId" = $1`,
        Array.of(walletToDelete),
      );
      if (Number(references.at(0).count) > 0) {
        throw new Error(`wallet row ${walletToDelete} has attached users; refusing destructive rollback`);
      }
    }

    // Record exactly what this rollback is about to delete before the destructive writes. The append-only
    // apply and rollback events survive the revert and make every ownership decision reconstructible.
    await writeAuditEvent(queryRunner, {
      action: ROLLBACK_ACTION,
      applyLogId: applyAudit.id,
      deletedAssetIds: assetsToDelete,
      deletedWalletId: walletToDelete ?? null,
    });

    for (const id of assetsToDelete) {
      await queryRunner.query(`DELETE FROM "asset" WHERE "id" = $1`, Array.of(id));
    }
    if (walletToDelete) {
      await queryRunner.query(`DELETE FROM "wallet" WHERE "id" = $1`, Array.of(walletToDelete));
    }
  }
};
