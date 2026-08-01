// Reset stuck MEXC/USDT redundancy pipeline 59563 (rule 299).
// USDT transfer MEXC→Binance (order 120779) stuck InProgress since 2026-04-08 00:49.
// Blocks all downstream liquidity: rule 299 Processing → no ZCHF deficit pipelines → buy_crypto 119135 (56k CHF) stuck in MissingLiquidity.
module.exports = class ResetStuckUsdtRedundancyPipeline1775654709000 {
  name = 'ResetStuckUsdtRedundancyPipeline1775654709000';

  async up(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_order"
      SET "status" = 'Failed',
          "errorMessage" = 'MEXC USDT withdrawal stuck InProgress for >13h, manual reset',
          "updated" = GETDATE()
      WHERE "id" = 120779 AND "status" = 'InProgress'
    `);
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_pipeline"
      SET "status" = 'Failed', "updated" = GETDATE()
      WHERE "id" = 59563 AND "status" = 'InProgress'
    `);
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Active', "updated" = GETDATE()
      WHERE "id" = 299 AND "status" = 'Processing'
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_order" SET "status" = 'InProgress', "errorMessage" = NULL, "updated" = GETDATE() WHERE "id" = 120779`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_pipeline" SET "status" = 'InProgress', "updated" = GETDATE() WHERE "id" = 59563`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Processing', "updated" = GETDATE() WHERE "id" = 299`,
    );
  }
};
