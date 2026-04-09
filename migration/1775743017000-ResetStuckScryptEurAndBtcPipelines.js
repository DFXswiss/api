// Reset stuck Scrypt/EUR redundancy pipeline 59525 (rule 313).
// Pipeline 59525: Order 120717 (EUR→USDT sell) trade completed on Scrypt, but order has
// status 'Completed' instead of 'Complete' (typo from manual fix or external write).
// checkRunningPipelines compares against enum 'Complete' — mismatch causes pipeline to
// stay InProgress indefinitely, blocking all Scrypt/EUR redundancy since 2026-04-07.
// Scrypt/EUR balance is 1.089M EUR vs max 1'000 EUR.
// Bitcoin rule 79 (Paused) auto-reactivates via reactivationTime=10, no manual fix needed.
// Root cause fix for the WS reconnect issue: PR #3549.
module.exports = class ResetStuckScryptEurAndBtcPipelines1775743017000 {
  name = 'ResetStuckScryptEurAndBtcPipelines1775743017000';

  async up(queryRunner) {
    // Fix order 120717: 'Completed' → 'Complete' (enum mismatch)
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_order"
      SET "status" = 'Complete', "updated" = GETDATE()
      WHERE "id" = 120717 AND "status" = 'Completed'
    `);

    // Complete the stuck Scrypt/EUR pipeline 59525
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_pipeline"
      SET "status" = 'Complete',
          "currentActionId" = NULL,
          "previousActionId" = 233,
          "ordersProcessed" = 2,
          "updated" = GETDATE()
      WHERE "id" = 59525 AND "status" = 'InProgress'
    `);

    // Reactivate Scrypt/EUR rule 313 (Processing → Active)
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Active', "updated" = GETDATE()
      WHERE "id" = 313 AND "status" = 'Processing'
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_order" SET "status" = 'Completed', "updated" = GETDATE() WHERE "id" = 120717`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_pipeline" SET "status" = 'InProgress', "currentActionId" = 233, "previousActionId" = 261, "ordersProcessed" = 1, "updated" = GETDATE() WHERE "id" = 59525`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Processing', "updated" = GETDATE() WHERE "id" = 313`,
    );
  }
};
