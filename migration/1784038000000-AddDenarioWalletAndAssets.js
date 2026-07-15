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

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddDenarioWalletAndAssets1784038000000 {
  name = 'AddDenarioWalletAndAssets1784038000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Partner wallet — idempotent on name; all other columns take their DB defaults.
    await queryRunner.query(
      `INSERT INTO "wallet" ("name", "displayName")
       SELECT 'Denario', 'Denario'
       WHERE NOT EXISTS (SELECT 1 FROM "wallet" WHERE "name" = 'Denario')`,
    );

    // Inert, list-only assets — idempotent on the stable uniqueName (ids are env-specific).
    await queryRunner.query(
      `INSERT INTO "asset"
         ("name", "uniqueName", "type", "blockchain", "category", "dexName", "chainId", "decimals", "description",
          "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
          "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon")
       SELECT 'DGC', 'Polygon/DGC', 'Token', 'Polygon', 'Public', 'DGC', '0xf7e2d612f1a0ce09ce9fc6fc0b59c7fd5b75042f', 8, 'Denario Gold Coin',
          false, false, false, false, false, false,
          false, false, true, false, false, false
       WHERE NOT EXISTS (SELECT 1 FROM "asset" WHERE "uniqueName" = 'Polygon/DGC')`,
    );

    await queryRunner.query(
      `INSERT INTO "asset"
         ("name", "uniqueName", "type", "blockchain", "category", "dexName", "chainId", "decimals", "description",
          "buyable", "sellable", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
          "paymentEnabled", "refEnabled", "refundEnabled", "ikna", "personalIbanEnabled", "comingSoon")
       SELECT 'DSC', 'Polygon/DSC', 'Token', 'Polygon', 'Public', 'DSC', '0x5d4e735784293a0a8d37761ad93c13a0dd35c7e7', 8, 'Denario Silver Coin',
          false, false, false, false, false, false,
          false, false, true, false, false, false
       WHERE NOT EXISTS (SELECT 1 FROM "asset" WHERE "uniqueName" = 'Polygon/DSC')`,
    );
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "asset" WHERE "uniqueName" IN ('Polygon/DGC', 'Polygon/DSC')`);
    await queryRunner.query(`DELETE FROM "wallet" WHERE "name" = 'Denario'`);
  }
};
