/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Data migration that creates the sZCHF custody asset — the interest-bearing Saving ZCHF
 * position surfaced by CustodyService.getUserCustodyBalance(). The interest itself is never
 * booked (no orders, no balance changes); this asset only exists so custody_balance rows and
 * Config.custody.savingAsset ('Ethereum/sZCHF') resolve to a real asset row.
 *
 * Unlike prod-only wiring migrations (e.g. AddBankFrickCustodyAssets), this asset is required
 * in every environment — the custody balance endpoint runs everywhere — so there is no
 * ENVIRONMENT guard here.
 *
 * Priced 1:1 off the existing 'Ethereum/ZCHF' asset via subquery (priceRuleId + all three
 * approxPriceXxx columns): sZCHF is a synthetic wrapper around ZCHF, not an independently
 * priced instrument. Single price source, no COALESCE fallback — fails loud if 'Ethereum/ZCHF'
 * is missing instead of inserting with a placeholder/undefined price.
 *
 * decimals/chainId/sortOrder stay NULL (omitted from the INSERT) — there is no on-chain token
 * backing this position. amlRuleFrom/amlRuleTo are omitted from the INSERT too, but unlike the
 * above they are NOT NULL DEFAULT AmlRule.DEFAULT (0) columns (asset.entity.ts) — omitting them
 * sets both to 0 (AmlRule.DEFAULT), not NULL.
 *
 * refundEnabled is false, unlike the entity default (true) and both reference migrations
 * (AddOlkyFrozenAsset, AddBankFrickCustodyAssets both set it true) — deliberately, to match the
 * other Custody assets already live in this system, which are also refundEnabled: false. sZCHF
 * is not tradable (buyable/sellable are false), so the refund path is never reached either way.
 *
 * up() acquires a transaction-scoped advisory lock before the idempotency check: uniqueName is
 * not DB-unique (only (dexName, type, blockchain) is), and this migration has no ENVIRONMENT
 * guard, so it can run concurrently from multiple app instances starting at once. Without the
 * lock, two concurrent runs could both pass the idempotency SELECT before either INSERTs, and
 * the second INSERT would crash on the unique index instead of no-op'ing. The lock key is this
 * migration's own timestamp — unique across migrations by naming convention, and far outside
 * hashtext()'s 32-bit range, so it can never collide with the application's hashtext()-based
 * advisory locks (setting.repository.ts, custody-account.service.ts, realunit.service.ts).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddSavingZchfAsset1785192244267 {
  name = 'AddSavingZchfAsset1785192244267';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    await queryRunner.query(`SELECT pg_advisory_xact_lock(1785192244267)`);

    // Idempotent: assets are keyed by the stable uniqueName (ids are env-specific).
    const existing = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Ethereum/sZCHF'`)).at(0);
    if (existing) return;

    // Fail-loud price-source guard: sZCHF has exactly one price source (Ethereum/ZCHF, 1:1).
    // No COALESCE fallback — an insert without a real price source would silently mask a
    // missing/renamed source asset.
    const priceSource = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'`)).at(
      0,
    );
    if (!priceSource) {
      throw new Error('Cannot create Ethereum/sZCHF custody asset: price source Ethereum/ZCHF not found');
    }

    await queryRunner.query(`
      INSERT INTO "asset"
        ("name", "uniqueName", "description", "type", "category", "blockchain", "dexName", "financialType",
         "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
         "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon",
         "priceRuleId", "approxPriceChf", "approxPriceEur", "approxPriceUsd")
      VALUES
        ('sZCHF', 'Ethereum/sZCHF', 'Saving ZCHF', 'Custody', 'Private', 'Ethereum', 'sZCHF', 'CHF',
         false, false, false, false, false, false,
         false, false, false, false, false, false,
         (SELECT "priceRuleId" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'),
         (SELECT "approxPriceChf" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'),
         (SELECT "approxPriceEur" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'),
         (SELECT "approxPriceUsd" FROM "asset" WHERE "uniqueName" = 'Ethereum/ZCHF'))
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // No FK-safety check, matching AddBankFrickCustodyAssets: rolling back an asset already
    // referenced by custody_balance/liquidity rows is an Ops procedure, not a plain revert.
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'Ethereum/sZCHF'`);
  }
};
