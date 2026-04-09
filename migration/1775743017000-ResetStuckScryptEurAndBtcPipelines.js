// Reset stuck Scrypt/EUR redundancy pipeline 59525 (rule 313).
// Pipeline 59525: Order 120717 (EUR→USDT sell) completed on 2026-04-07 13:36, but pipeline
// was never advanced to Complete — stuck InProgress since then, blocking all Scrypt/EUR redundancy.
// Scrypt/EUR balance is 1.089M EUR vs max 1'000 EUR.
// Bitcoin rule 79 (Paused) auto-reactivates via reactivationTime=10, no manual fix needed.
// Once rule 313 is Active again, sell-if-deficit will pick up the pending BTC demand
// (697k CHF from buy_crypto 119330) and sell EUR→BTC on Scrypt.
module.exports = class ResetStuckScryptEurAndBtcPipelines1775743017000 {
  name = 'ResetStuckScryptEurAndBtcPipelines1775743017000';

  async up(queryRunner) {
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
      `UPDATE "dbo"."liquidity_management_pipeline" SET "status" = 'InProgress', "currentActionId" = 233, "previousActionId" = 261, "ordersProcessed" = 1, "updated" = GETDATE() WHERE "id" = 59525`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Processing', "updated" = GETDATE() WHERE "id" = 313`,
    );
  }
};
