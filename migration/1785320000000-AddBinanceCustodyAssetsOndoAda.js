/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Data migration that creates the missing Binance Custody master-data rows for ONDO and ADA
 * (Binance/ONDO, Binance/ADA).
 *
 * Every asset DFX holds on an exchange needs a second `asset` row with type='Custody' and
 * blockchain=<ExchangeName>, separate from the on-chain asset. LedgerBootstrapService can only
 * create a ledger CoA account for rows that exist — without these Custody rows, exchange-tx
 * ledger posting fail-closes with "Ledger account Binance/ONDO not found (CoA bootstrap
 * missing)" and stalls the consumer watermark.
 *
 * Unlike prod-only wiring migrations (e.g. AddBankFrickCustodyAssets), these rows are pure
 * master data with no LiquidityManagementRule, bank link, or external API side effect — they
 * are correct and desired in every environment identically, so there is no ENVIRONMENT guard.
 * Only LOC also mirrors them via migration/seed/asset.csv (ids 413/414); DEV/CI/PRD get them
 * solely via this migration.
 *
 * Each asset is priced off a single on-chain source via subquery (no COALESCE fallback):
 *   Binance/ONDO ← Ethereum/ONDO
 *   Binance/ADA  ← Cardano/ADA
 * The fail-loud price-source guards only check that the source row exists (SELECT "id"); they
 * do not check whether that row has a priceRuleId. A source with priceRuleId IS NULL is a
 * legitimate state — migration/seed/asset.csv ships Ethereum/ONDO with an empty priceRuleId —
 * and the INSERT subquery correctly and silently carries that NULL over, same as the precedent
 * AddSavingZchfAsset. What the guards actually prevent is a missing or renamed source row.
 *
 * decimals/sortOrder stay NULL (omitted from the INSERT) — same as every existing Custody
 * asset. refundEnabled is false (unlike the entity default of true), matching other live
 * Custody assets in this system.
 *
 * up() acquires a transaction-scoped advisory lock before the idempotency checks and
 * price-source guards: uniqueName is not DB-unique (only (dexName, type, blockchain) is),
 * and this migration has no ENVIRONMENT guard, so it can run concurrently from multiple
 * app instances starting at once. Without the lock, two concurrent runs could both pass
 * the idempotency SELECT before either INSERTs, and the second INSERT would crash on the
 * unique index instead of no-op'ing. The lock key is this migration's own timestamp —
 * unique across migrations by naming convention, and far outside hashtext()'s 32-bit
 * range, so it can never collide with the application's hashtext()-based advisory locks
 * (setting.repository.ts, custody-account.service.ts, realunit.service.ts). There is no
 * SET LOCAL lock_timeout — unlike AddBankFrickCustodyAssets this path has no bank-table
 * UPDATE contending for row locks under load; the advisory lock alone serializes concurrent
 * up() execution.
 *
 * up() is fully idempotent per uniqueName: each asset's existence check runs before its
 * price-source guard, so a re-run against an already-created row never depends on the source
 * asset still existing under the same name. down() has no lock (rollback is a deliberate
 * manual Ops action, not a multi-instance boot race) and deletes both rows by uniqueName;
 * the DELETE fails loud (FK violation) if a liquidity_balance / ledger row already
 * references them — intentional: rolling back a used wiring is an Ops procedure, not a
 * plain migration revert.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBinanceCustodyAssetsOndoAda1785320000000 {
  name = 'AddBinanceCustodyAssetsOndoAda1785320000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SELECT pg_advisory_xact_lock(1785320000000)`);

    // --- Binance/ONDO ---
    // Idempotent: assets are keyed by the stable uniqueName (ids are env-specific). Checked
    // before the price-source guard so a re-run against an already-created row never depends
    // on the source asset still existing under the same name.
    const ondoExisting = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Binance/ONDO'`)).at(
      0,
    );
    if (!ondoExisting) {
      // Fail-loud price-source guard: ONDO has exactly one price source (Ethereum/ONDO).
      // No COALESCE fallback — an insert without a real price source would silently mask a
      // missing/renamed source asset.
      const ondoPriceSource = (
        await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'`)
      ).at(0);
      if (!ondoPriceSource) {
        throw new Error('Cannot create Binance/ONDO custody asset: price source Ethereum/ONDO not found');
      }

      await queryRunner.query(`
        INSERT INTO "asset"
          ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
           "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
           "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
           "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
        VALUES
          ('ONDO', 'Binance/ONDO', 'Custody', 'Binance', 'Private', 'ONDO', 'Other',
           false, false, false, false, false, false,
           false, false, false, false, false, false,
           (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'),
           (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'),
           (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'),
           (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Ethereum/ONDO'))
      `);
    }

    // --- Binance/ADA ---
    // Idempotent: assets are keyed by the stable uniqueName (ids are env-specific). Checked
    // before the price-source guard so a re-run against an already-created row never depends
    // on the source asset still existing under the same name.
    const adaExisting = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Binance/ADA'`)).at(0);
    if (!adaExisting) {
      // Fail-loud price-source guard: ADA has exactly one price source (Cardano/ADA).
      // No COALESCE fallback — an insert without a real price source would silently mask a
      // missing/renamed source asset.
      const adaPriceSource = (
        await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA'`)
      ).at(0);
      if (!adaPriceSource) {
        throw new Error('Cannot create Binance/ADA custody asset: price source Cardano/ADA not found');
      }

      await queryRunner.query(`
        INSERT INTO "asset"
          ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType",
           "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
           "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
           "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
        VALUES
          ('ADA', 'Binance/ADA', 'Custody', 'Binance', 'Private', 'ADA', 'Other',
           false, false, false, false, false, false,
           false, false, false, false, false, false,
           (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA'),
           (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA'),
           (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA'),
           (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Cardano/ADA'))
      `);
    }
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // No advisory lock: rollback is a deliberate manual Ops action, not a multi-instance boot
    // race the way up() is. No FK-safety check, matching AddBankFrickCustodyAssets: rolling
    // back an asset already referenced by liquidity_balance / ledger rows is an Ops procedure,
    // not a plain revert. This DELETE will fail loud (FK violation) if such a reference
    // already exists — intentional.
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" IN ('Binance/ONDO', 'Binance/ADA')`);
  }
};
