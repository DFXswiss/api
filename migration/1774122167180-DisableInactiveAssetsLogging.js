module.exports = class DisableInactiveAssetsLogging1774122167180 {
  name = 'DisableInactiveAssetsLogging1774122167180';

  async up(queryRunner) {
    // Disable XT liquidity management rules (XT/BTC, XT/USDC, XT/SOL)
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Disabled' WHERE "id" IN (292, 293, 297)`,
    );

    // Delete liquidity balances for Kaleido/CHF and XT/BTC, XT/USDC, XT/SOL
    await queryRunner.query(`DELETE FROM "dbo"."liquidity_balance" WHERE "id" IN (233, 288, 289, 293)`);

    // Disable Sumixx assets (cardBuyable + instantBuyable)
    await queryRunner.query(
      `UPDATE "dbo"."asset" SET "cardBuyable" = 0, "instantBuyable" = 0 WHERE "id" IN (304, 305, 306, 307)`,
    );
  }

  async down(queryRunner) {
    // Re-enable Sumixx assets
    await queryRunner.query(
      `UPDATE "dbo"."asset" SET "cardBuyable" = 1, "instantBuyable" = 1 WHERE "id" IN (304, 305, 306, 307)`,
    );

    // Re-enable XT liquidity management rules (restore original status)
    await queryRunner.query(`UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Active' WHERE "id" = 292`);
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Inactive' WHERE "id" IN (293, 297)`,
    );
  }
};
