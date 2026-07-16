/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * PROD-ONLY data migration that wires Bank Frick into equity / liquidity / accounting.
 *
 * Creates two Custody assets (Frick/EUR, Frick/CHF), links them to active Bank Frick bank rows
 * via bank.assetId (NULL → value fill only), and registers observe-only LiquidityManagementRules
 * so balance refresh runs for Frick without ever triggering fund-moving actions.
 *
 * Guarded to `ENVIRONMENT === 'prd'` (same rationale as ActivateBankFrick): an unguarded
 * status='Active' Frick LM rule would make the EVERY_MINUTE liquidity cron call
 * frickService.getBalances() in every non-prod environment (no Frick credentials there) and
 * log an error every minute. On dev/loc/CI this migration is a complete no-op; local/dev
 * obtain the Frick custody assets from migration/seed/asset.csv instead (ids 411/412),
 * unlinked from any bank row and without an LM rule — matching the dormant seed Bank Frick
 * rows (receive=FALSE, send=FALSE).
 *
 * Fully idempotent and additive-only on prod: never overwrites a non-null assetId, never
 * deletes pre-existing rows.
 *
 * up():
 *   1. prod guard (no-op elsewhere)
 *   2. lock_timeout
 *   3. fail-loud price-source guard (Yapeal/* primary, Olkypay/* fallback) per currency
 *   4. insert Frick/EUR + Frick/CHF custody assets with COALESCE-inlined price columns
 *      (idempotent per uniqueName)
 *   5. link active Bank Frick bank rows (receive+send, assetId IS NULL) via uniqueName subquery
 *   6. fail-loud post-condition: every active Frick bank row must now have a non-null assetId
 *   7. insert observe-only LM rules (context='Bank Frick', Active, targetAsset via subquery,
 *      everything else NULL) so LiquidityManagementService refreshes balances without ever
 *      calling executeRule
 *
 * down() reverses in FK-safe order (rules → unlink bank → delete assets), prod-guarded the
 * same way. Asset DELETE fails loud (FK violation) if a liquidity_balance / ledger row already
 * references them — intentional: rolling back a used wiring is an Ops procedure, not a plain
 * migration revert.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankFrickCustodyAssets1784500000000 {
  name = 'AddBankFrickCustodyAssets1784500000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Active Frick LM rules must NEVER run on dev/loc/CI — there the Frick custody assets come
    // from migration/seed/asset.csv (unlinked) and the Bank Frick registry is dormant. Returning
    // early still records the migration as executed, which is the intended no-op on lower
    // environments.
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // --- Frick/EUR ---
    const eurPriceSources = (
      await queryRunner.query(
        `SELECT COUNT(*)::int AS n FROM "asset" WHERE "uniqueName" IN ('Yapeal/EUR', 'Olkypay/EUR')`,
      )
    ).at(0);
    if (eurPriceSources.n === 0) {
      throw new Error(
        'Cannot create Frick/EUR custody asset: no price source found (tried Yapeal/EUR and Olkypay/EUR)',
      );
    }

    const frickEurExisting = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/EUR'`)).at(
      0,
    );
    if (!frickEurExisting) {
      await queryRunner.query(`
        INSERT INTO "asset"
          ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
           "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
           "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
           "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
        VALUES
          ('EUR', 'Frick/EUR', 'Custody', 'Frick', 'Private', 'EUR', 'EUR',
           false, false, false, false, false, false,
           false, false, true, false, false, false,
           COALESCE(
             (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Yapeal/EUR'),
             (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Olkypay/EUR')
           ),
           COALESCE(
             (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Yapeal/EUR'),
             (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Olkypay/EUR')
           ),
           COALESCE(
             (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Yapeal/EUR'),
             (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Olkypay/EUR')
           ),
           COALESCE(
             (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Yapeal/EUR'),
             (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Olkypay/EUR')
           ))
      `);
    }

    // --- Frick/CHF ---
    const chfPriceSources = (
      await queryRunner.query(
        `SELECT COUNT(*)::int AS n FROM "asset" WHERE "uniqueName" IN ('Yapeal/CHF', 'Olkypay/CHF')`,
      )
    ).at(0);
    if (chfPriceSources.n === 0) {
      throw new Error(
        'Cannot create Frick/CHF custody asset: no price source found (tried Yapeal/CHF and Olkypay/CHF)',
      );
    }

    const frickChfExisting = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/CHF'`)).at(
      0,
    );
    if (!frickChfExisting) {
      await queryRunner.query(`
        INSERT INTO "asset"
          ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
           "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
           "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
           "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
        VALUES
          ('CHF', 'Frick/CHF', 'Custody', 'Frick', 'Private', 'CHF', 'CHF',
           false, false, false, false, false, false,
           false, false, true, false, false, false,
           COALESCE(
             (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Yapeal/CHF'),
             (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Olkypay/CHF')
           ),
           COALESCE(
             (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Yapeal/CHF'),
             (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Olkypay/CHF')
           ),
           COALESCE(
             (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Yapeal/CHF'),
             (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Olkypay/CHF')
           ),
           COALESCE(
             (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Yapeal/CHF'),
             (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Olkypay/CHF')
           ))
      `);
    }

    // Pure NULL→value fill on active Frick rows only; asset resolved by stable uniqueName.
    await queryRunner.query(`
      UPDATE "bank" SET "assetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/EUR')
      WHERE "name" = 'Bank Frick' AND "currency" = 'EUR' AND "receive" = true AND "send" = true AND "assetId" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "bank" SET "assetId" = (SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/CHF')
      WHERE "name" = 'Bank Frick' AND "currency" = 'CHF' AND "receive" = true AND "send" = true AND "assetId" IS NULL
    `);

    // Fail-loud post-condition: every active Frick bank row must be linked. Vacuously true when no
    // active Frick rows exist (e.g. schema-only fixture / pre-activation).
    const unlinked = await queryRunner.query(
      `SELECT "id", "currency" FROM "bank"
       WHERE "name" = 'Bank Frick' AND "receive" = true AND "send" = true AND "assetId" IS NULL`,
    );
    if (unlinked.length > 0) {
      throw new Error('Bank Frick custody-asset wiring incomplete');
    }

    // Observe-only LM rules: minimal/maximal/actions all NULL so LiquidityManagementRule.verify()
    // always returns action:null. status=Active so checkLiquidityBalances still refreshes the balance.
    // targetFiatId deliberately omitted (NULL) — rule targets the Custody asset only.
    const eurRuleExisting = (
      await queryRunner.query(`
        SELECT lmr."id" FROM "liquidity_management_rule" lmr
        JOIN "asset" a ON a."id" = lmr."targetAssetId"
        WHERE lmr."context" = 'Bank Frick' AND a."uniqueName" = 'Frick/EUR' AND lmr."targetFiatId" IS NULL
      `)
    ).at(0);
    if (!eurRuleExisting) {
      await queryRunner.query(`
        INSERT INTO "liquidity_management_rule" ("context", "status", "targetAssetId")
        VALUES ('Bank Frick', 'Active', (SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/EUR'))
      `);
    }

    const chfRuleExisting = (
      await queryRunner.query(`
        SELECT lmr."id" FROM "liquidity_management_rule" lmr
        JOIN "asset" a ON a."id" = lmr."targetAssetId"
        WHERE lmr."context" = 'Bank Frick' AND a."uniqueName" = 'Frick/CHF' AND lmr."targetFiatId" IS NULL
      `)
    ).at(0);
    if (!chfRuleExisting) {
      await queryRunner.query(`
        INSERT INTO "liquidity_management_rule" ("context", "status", "targetAssetId")
        VALUES ('Bank Frick', 'Active', (SELECT "id" FROM "asset" WHERE "uniqueName" = 'Frick/CHF'))
      `);
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    if (process.env.ENVIRONMENT !== 'prd') return;

    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    // Rules first (FK-safe), then unlink bank rows, then delete assets.
    await queryRunner.query(`
      DELETE FROM "liquidity_management_rule"
      WHERE "context" = 'Bank Frick'
        AND "targetAssetId" IN (
          SELECT "id" FROM "asset" WHERE "uniqueName" IN ('Frick/EUR', 'Frick/CHF')
        )
    `);

    await queryRunner.query(`
      UPDATE "bank" SET "assetId" = NULL
      WHERE "assetId" IN (
        SELECT "id" FROM "asset" WHERE "uniqueName" IN ('Frick/EUR', 'Frick/CHF')
      )
    `);

    // This DELETE will fail loud (FK violation) if a liquidity_balance / ledger row already
    // references these assets by the time someone rolls this back — that is intentional: rolling
    // back a used wiring is an Ops procedure, not a plain migration revert.
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" IN ('Frick/EUR', 'Frick/CHF')`);
  }
};
