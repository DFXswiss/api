// Citrea Testnet is sunset: the chain's node/explorer infrastructure is removed
// and dfx-api no longer wires payin/payout/dex/liquidity for it. Deactivate all
// CitreaTestnet assets and drop their blockchain_fee rows (the fee cron reads
// those rows regardless of asset flags). Keyed on the blockchain column.
module.exports = class DeactivateCitreaTestnetAssets1783428526141 {
  name = 'DeactivateCitreaTestnetAssets1783428526141';

  async up(queryRunner) {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*) AS count FROM "asset"
      WHERE "blockchain" = 'CitreaTestnet'
        AND ("buyable" = true OR "sellable" = true OR "instantBuyable" = true)
    `);

    await queryRunner.query(`
      DELETE FROM "blockchain_fee"
      WHERE "assetId" IN (SELECT "id" FROM "asset" WHERE "blockchain" = 'CitreaTestnet')
    `);

    await queryRunner.query(`
      UPDATE "liquidity_management_rule"
      SET "status" = 'Disabled'
      WHERE "targetAssetId" IN (SELECT "id" FROM "asset" WHERE "blockchain" = 'CitreaTestnet')
        AND "status" != 'Disabled'
    `);

    if (parseInt(count) === 0) return;

    await queryRunner.query(`
      UPDATE "asset"
      SET "buyable" = false, "sellable" = false, "instantBuyable" = false
      WHERE "blockchain" = 'CitreaTestnet'
    `);
  }

  async down() {
    // irreversible by design: the chain is sunset
  }
};
