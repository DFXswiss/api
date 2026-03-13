/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Add liquidity management actions and rule for XT/JUSD.
 *
 * Pattern follows XT/dEURO (rule 295, actions 194/230):
 *   Action 1: DfxDex withdraw — transfer JUSD from Citrea (asset 411) to XT
 *   Action 2: LiquidityPipeline buy — buy JUSD on Citrea (asset 411), then retry Action 1
 *   Rule: target XT/JUSD (asset 425), deficit starts with Action 1
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddXtJusdLiquidityManagement1773170888000 {
  name = 'AddXtJusdLiquidityManagement1773170888000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Action 1: DfxDex withdraw JUSD (Citrea) → XT (onFailId set after Action 2 is created)
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag", "onSuccessId", "onFailId")
      VALUES ('DfxDex', 'withdraw', '{"destinationAddress":"XT_EVM_DEPOSIT_ADDRESS","destinationSystem":"XT","assetId":411}', 'XT JUSD', NULL, NULL)
    `);

    // Get the ID of Action 1
    const [{ id: action1Id }] = await queryRunner.query(`
      SELECT "id" FROM "dbo"."liquidity_management_action"
      WHERE "system" = 'DfxDex' AND "command" = 'withdraw' AND "tag" = 'XT JUSD'
    `);

    // Action 2: LiquidityPipeline buy JUSD (Citrea, asset 411) → onSuccess chains to Action 1
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag", "onSuccessId", "onFailId")
      VALUES ('LiquidityPipeline', 'buy', '{"assetId":411}', 'XT JUSD', ${action1Id}, NULL)
    `);

    // Get the ID of Action 2
    const [{ id: action2Id }] = await queryRunner.query(`
      SELECT "id" FROM "dbo"."liquidity_management_action"
      WHERE "system" = 'LiquidityPipeline' AND "command" = 'buy' AND "tag" = 'XT JUSD'
    `);

    // Link Action 1 onFail → Action 2
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_action"
      SET "onFailId" = ${action2Id}
      WHERE "id" = ${action1Id}
    `);

    // Rule: XT/JUSD (asset 425), deficit starts with Action 1
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_rule"
        ("context", "status", "minimal", "optimal", "maximal", "targetAssetId", "targetFiatId",
         "deficitStartActionId", "redundancyStartActionId", "reactivationTime", "sendNotifications", "delayActivation")
      VALUES
        ('XT', 'Active', 10000, 20000, NULL, 425, NULL,
         ${action1Id}, NULL, 10, 1, 0)
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Delete rule first (FK to actions)
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_rule"
      WHERE "context" = 'XT' AND "targetAssetId" = 425
    `);

    // Delete actions
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_action" SET "onFailId" = NULL, "onSuccessId" = NULL WHERE "tag" = 'XT JUSD'
    `);
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_action" WHERE "tag" = 'XT JUSD'
    `);
  }
};
