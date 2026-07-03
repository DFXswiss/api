/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddOlkyFrozenAsset1783109567000 {
  name = 'AddOlkyFrozenAsset1783109567000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Idempotent env-guard: assets are keyed by the stable uniqueName (ids are env-specific).
    const existing = (await queryRunner.query(`SELECT "id" FROM "asset" WHERE "uniqueName" = 'OlkyFrozen/EUR'`)).at(0);
    if (existing) return;

    // Inert, manual-only custody asset for frozen Olky EUR balances.
    // - id omitted -> SERIAL assigns it; "created"/"updated" omitted -> DEFAULT now().
    // - no priceRuleId -> excluded from the hourly price job (no automatic price updates).
    // - every trade/payment flag false -> isActive=false, so no cron/observable picks it up.
    await queryRunner.query(
      `INSERT INTO "asset"
         ("name", "uniqueName", "type", "blockchain", "category", "dexName", "financialType", "approxPriceEur",
          "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
          "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon")
       VALUES
         ('EUR', 'OlkyFrozen/EUR', 'Custody', 'OlkyFrozen', 'Private', 'EUR', 'EUR', 1,
          false, false, false, false, false, false,
          false, false, true, false, false, false)`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" = 'OlkyFrozen/EUR'`);
  }
};
