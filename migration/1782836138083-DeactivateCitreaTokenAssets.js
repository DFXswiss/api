// Citrea USDC.e/WBTC.e are flagged tradeable but cannot currently be paid out on
// Citrea, so fee estimates revert and buys can't be fulfilled — deactivate them.
// The fee cron reads blockchain_fee rows directly (ignores asset flags), so those
// rows must go too. Keyed on uniqueName; asset ids are env-specific.
module.exports = class DeactivateCitreaTokenAssets1782836138083 {
  name = 'DeactivateCitreaTokenAssets1782836138083';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM "asset"
      WHERE "uniqueName" IN ('Citrea/USDC.e', 'Citrea/WBTC.e')
        AND ("buyable" = true OR "sellable" = true OR "instantBuyable" = true)
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE "asset"
      SET "buyable" = false, "sellable" = false, "instantBuyable" = false
      WHERE "uniqueName" IN ('Citrea/USDC.e', 'Citrea/WBTC.e')
    `);

    await queryRunner.query(`
      DELETE FROM "blockchain_fee"
      WHERE "assetId" IN (
        SELECT "id" FROM "asset" WHERE "uniqueName" IN ('Citrea/USDC.e', 'Citrea/WBTC.e')
      )
    `);
  }

  async down(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM "asset"
      WHERE "uniqueName" IN ('Citrea/USDC.e', 'Citrea/WBTC.e')
    `);
    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE "asset"
      SET "buyable" = true, "sellable" = true, "instantBuyable" = true
      WHERE "uniqueName" IN ('Citrea/USDC.e', 'Citrea/WBTC.e')
    `);

    await queryRunner.query(`
      INSERT INTO "blockchain_fee" ("amount", "assetId")
      SELECT 0, a."id" FROM "asset" a
      WHERE a."uniqueName" IN ('Citrea/USDC.e', 'Citrea/WBTC.e')
        AND NOT EXISTS (SELECT 1 FROM "blockchain_fee" f WHERE f."assetId" = a."id")
    `);
  }
};
