/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Set up JUSD (Citrea) liquidity management with bridge-in action chain.
 *
 * Creates two chained actions for rule 321 (JUSD/Citrea, currently Inactive):
 *   Action A: Juice bridge-in (USDT.e) — on failure, falls back to Action B
 *   Action B: LiquidityPipeline buy (assetId 414) — on success, retries Action A
 *
 * Then activates rule 321 with deficit thresholds and links the action chain.
 *
 * Pattern follows dEURO Ethereum bridge-in (rule 259, actions 222/228).
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddJusdBridgeInLiquidityManagement1772600000000 {
  name = 'AddJusdBridgeInLiquidityManagement1772600000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Step 1: Insert Action A (Juice bridge-in) without onFailId
    const [actionA] = await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag")
      OUTPUT INSERTED.id
      VALUES ('Juice', 'bridge-in', '{"asset":"USDT.e"}', 'CITREA JUSD')
    `);

    // Step 2: Insert Action B (LiquidityPipeline buy) with onSuccessId → Action A
    const [actionB] = await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "params", "tag", "onSuccessId")
      OUTPUT INSERTED.id
      VALUES ('LiquidityPipeline', 'buy', '{"assetId":414}', 'CITREA JUSD', ${actionA.id})
    `);

    // Step 3: Link Action A's onFailId → Action B
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_action"
      SET "onFailId" = ${actionB.id}
      WHERE "id" = ${actionA.id}
    `);

    // Step 4: Activate rule 321 with thresholds and deficit action chain
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "minimal" = 0, "optimal" = 1000, "maximal" = NULL,
          "deficitStartActionId" = ${actionA.id},
          "status" = 'Active'
      WHERE "id" = 321
    `);
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Step 1: Deactivate rule 321 and unlink action chain
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "deficitStartActionId" = NULL, "minimal" = NULL, "optimal" = NULL, "maximal" = NULL,
          "status" = 'Inactive'
      WHERE "id" = 321
    `);

    // Step 2: Break circular FK before deleting actions
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_action"
      SET "onFailId" = NULL
      WHERE "tag" = 'CITREA JUSD' AND "system" = 'Juice'
    `);

    // Step 3: Delete both actions
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_action"
      WHERE "tag" = 'CITREA JUSD' AND "system" IN ('Juice', 'LiquidityPipeline')
    `);
  }
};
