/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add liquidity management rules for Citrea assets (USDC.e, USDT.e, WBTC.e)
 * using the LayerZero bridge adapter (Ethereum -> Citrea).
 *
 * Creates 3 deficit actions (deposit via LayerZeroBridge) and 3 rules
 * (one per asset). No redundancy action since the LayerZero adapter
 * only supports deposit (ETH -> Citrea), not withdraw.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddCitreaLiquidityManagementRules1772100000000 {
  name = 'AddCitreaLiquidityManagementRules1772100000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Create deficit actions for each Citrea asset
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag")
      VALUES ('LayerZeroBridge', 'deposit', NULL, 'LZ Bridge USDC.e')
    `);

    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag")
      VALUES ('LayerZeroBridge', 'deposit', NULL, 'LZ Bridge USDT.e')
    `);

    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag")
      VALUES ('LayerZeroBridge', 'deposit', NULL, 'LZ Bridge WBTC.e')
    `);

    // Create rules for USDC.e (asset 413), USDT.e (asset 414), WBTC.e (asset 415)
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_rule"
        ("context", "status", "targetAssetId", "minimal", "optimal", "maximal",
         "deficitStartActionId", "redundancyStartActionId", "reactivationTime",
         "delayActivation", "sendNotifications")
      VALUES
        ('Citrea', 'Active', 413, 0, 1000, 1000000,
         (SELECT "id" FROM "dbo"."liquidity_management_action" WHERE "tag" = 'LZ Bridge USDC.e'),
         NULL, 10, 1, 1)
    `);

    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_rule"
        ("context", "status", "targetAssetId", "minimal", "optimal", "maximal",
         "deficitStartActionId", "redundancyStartActionId", "reactivationTime",
         "delayActivation", "sendNotifications")
      VALUES
        ('Citrea', 'Active', 414, 0, 1000, 1000000,
         (SELECT "id" FROM "dbo"."liquidity_management_action" WHERE "tag" = 'LZ Bridge USDT.e'),
         NULL, 10, 1, 1)
    `);

    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_rule"
        ("context", "status", "targetAssetId", "minimal", "optimal", "maximal",
         "deficitStartActionId", "redundancyStartActionId", "reactivationTime",
         "delayActivation", "sendNotifications")
      VALUES
        ('Citrea', 'Active', 415, 0, 1000, 1000000,
         (SELECT "id" FROM "dbo"."liquidity_management_action" WHERE "tag" = 'LZ Bridge WBTC.e'),
         NULL, 10, 1, 1)
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Delete rules first (they reference actions via FK)
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_rule"
      WHERE "context" = 'Citrea' AND "targetAssetId" IN (413, 414, 415)
    `);

    // Delete actions
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_action"
      WHERE "tag" IN ('LZ Bridge USDC.e', 'LZ Bridge USDT.e', 'LZ Bridge WBTC.e')
    `);
  }
};
