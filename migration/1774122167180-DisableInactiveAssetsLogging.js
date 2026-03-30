module.exports = class DisableInactiveAssetsLogging1774122167180 {
  name = 'DisableInactiveAssetsLogging1774122167180';

  async up(queryRunner) {
    // Disable XT liquidity management rules (XT/BTC, XT/USDC, XT/SOL)
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Disabled' WHERE "id" IN (292, 293, 297)`,
    );

    // Disable Kraken liquidity management rules
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Disabled' WHERE "id" IN (193, 194, 197, 199, 200, 202, 207, 209, 211, 213, 214, 215, 242, 248, 306)`,
    );

    // Disable Pool liquidity management rules (only pools with balance = 0)
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Disabled' WHERE "id" IN (230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 243, 244, 245, 246, 257, 258, 261, 262, 265, 266, 269, 270, 275, 277, 283, 284, 285, 286, 287)`,
    );

    // Delete liquidity balances for Kaleido/CHF, MaerkiBaumann/USD, XT/BTC, XT/USDC, XT/SOL
    await queryRunner.query(`DELETE FROM "dbo"."liquidity_balance" WHERE "id" IN (217, 233, 288, 289, 293)`);

    // Delete liquidity balances for Kraken
    await queryRunner.query(
      `DELETE FROM "dbo"."liquidity_balance" WHERE "id" IN (202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 235, 241, 302)`,
    );

    // Delete liquidity balances for Pools with balance = 0
    await queryRunner.query(
      `DELETE FROM "dbo"."liquidity_balance" WHERE "id" IN (223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 236, 237, 238, 239, 253, 254, 257, 258, 261, 262, 265, 266, 271, 273, 276, 277, 281, 282, 283)`,
    );

    // Disable Sumixx and Talium assets (cardBuyable + instantBuyable + buyable)
    await queryRunner.query(
      `UPDATE "dbo"."asset" SET "buyable" = 0, "cardBuyable" = 0, "instantBuyable" = 0 WHERE "id" IN (238, 304, 305, 306, 307)`,
    );
  }

  async down(queryRunner) {
    // Re-enable Sumixx assets
    await queryRunner.query(
      `UPDATE "dbo"."asset" SET "cardBuyable" = 1, "instantBuyable" = 1 WHERE "id" IN (304, 305, 306, 307)`,
    );

    // Re-enable Talium/DMCS
    await queryRunner.query(
      `UPDATE "dbo"."asset" SET "buyable" = 1, "cardBuyable" = 1, "instantBuyable" = 1 WHERE "id" = 238`,
    );

    // Re-enable XT liquidity management rules (restore original status)
    await queryRunner.query(`UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Active' WHERE "id" = 292`);
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Inactive' WHERE "id" IN (293, 297)`,
    );

    // Re-enable Kraken liquidity management rules (restore original status)
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Active' WHERE "id" IN (193, 211, 215, 248)`,
    );
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Inactive' WHERE "id" IN (194, 197, 199, 200, 202, 207, 209, 213, 214, 242, 306)`,
    );

    // Re-enable Pool liquidity management rules (restore to Inactive)
    await queryRunner.query(
      `UPDATE "dbo"."liquidity_management_rule" SET "status" = 'Inactive' WHERE "id" IN (230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 243, 244, 245, 246, 257, 258, 261, 262, 265, 266, 269, 270, 275, 277, 283, 284, 285, 286, 287)`,
    );
  }
};
