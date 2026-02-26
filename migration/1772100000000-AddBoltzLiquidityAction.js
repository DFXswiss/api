/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * Create Boltz deposit action and wire it as onFail fallback for Clementine (Action 236).
 * Configure and activate Rule 320 (Citrea cBTC) with thresholds.
 *
 * Strategy: Clementine (fee-free, 10 BTC fixed) remains primary deficit action.
 * When Clementine fails (e.g. insufficient balance < 10 BTC), Boltz handles
 * flexible amounts (with fees) as fallback.
 *
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBoltzLiquidityAction1772100000000 {
  name = 'AddBoltzLiquidityAction1772100000000';

  /**
   * @param {QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // Step 1: Create Boltz deposit action
    await queryRunner.query(`
      INSERT INTO "dbo"."liquidity_management_action" ("system", "command", "tag")
      VALUES ('Boltz', 'deposit', 'cBTC')
    `);

    // Step 2: Get the newly created action ID
    const [boltzAction] = await queryRunner.query(`
      SELECT "id" FROM "dbo"."liquidity_management_action"
      WHERE "system" = 'Boltz' AND "command" = 'deposit'
    `);

    if (!boltzAction) {
      throw new Error('Failed to create Boltz action');
    }

    console.log(`Created Boltz action with id=${boltzAction.id}`);

    // Step 3: Set Boltz as onFail fallback for Clementine (Action 236)
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_action"
      SET "onFailId" = ${boltzAction.id}
      WHERE "id" = 236
    `);

    // Step 4: Configure and activate Rule 320 (Citrea cBTC)
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Active',
          "minimal" = 0,
          "optimal" = 0.1,
          "maximal" = 0.5,
          "reactivationTime" = 10
      WHERE "id" = 320
    `);

    console.log('Rule 320 activated: minimal=0, optimal=0.1, maximal=0.5');
  }

  /**
   * @param {QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Revert Rule 320 to inactive
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Inactive',
          "minimal" = NULL,
          "optimal" = NULL,
          "maximal" = NULL,
          "reactivationTime" = NULL
      WHERE "id" = 320
    `);

    // Remove onFail link from Clementine action
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_action"
      SET "onFailId" = NULL
      WHERE "id" = 236
    `);

    // Delete Boltz action
    await queryRunner.query(`
      DELETE FROM "dbo"."liquidity_management_action"
      WHERE "system" = 'Boltz' AND "command" = 'deposit'
    `);
  }
};
