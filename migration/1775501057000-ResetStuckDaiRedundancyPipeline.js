// Reset stuck Ethereum/DAI redundancy pipeline 58786 (rule 82).
// On-chain TX reverted with Dai/insufficient-balance due to Number↔Wei precision rounding.
// Completion check never detects reverted TXs → order stuck InProgress since 2026-04-02.
module.exports = class ResetStuckDaiRedundancyPipeline1775501057000 {
  name = 'ResetStuckDaiRedundancyPipeline1775501057000';

  async up(queryRunner) {
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_order"
      SET "status" = 'Failed',
          "errorMessage" = 'On-chain TX reverted: Dai/insufficient-balance (Number/Wei precision rounding)',
          "updated" = GETDATE()
      WHERE "id" = 118943 AND "status" = 'InProgress'
    `);
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_pipeline"
      SET "status" = 'Failed', "updated" = GETDATE()
      WHERE "id" = 58786 AND "status" = 'InProgress'
    `);
    await queryRunner.query(`
      UPDATE "dbo"."liquidity_management_rule"
      SET "status" = 'Active', "updated" = GETDATE()
      WHERE "id" = 82 AND "status" = 'Processing'
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_order" SET "status" = 'InProgress', "errorMessage" = NULL, "updated" = GETDATE() WHERE "id" = 118943`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_pipeline" SET "status" = 'InProgress', "updated" = GETDATE() WHERE "id" = 58786`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Processing', "updated" = GETDATE() WHERE "id" = 82`,
    );
  }
};
