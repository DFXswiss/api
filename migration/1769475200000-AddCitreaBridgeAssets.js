const { MigrationInterface, QueryRunner } = require('typeorm');

/**
 * Add Citrea Mainnet bridge assets: USDC.e, USDT.e, WBTC.e, and ctUSD.
 *
 * These are LayerZero bridged stablecoins and wrapped BTC on Citrea Mainnet:
 * - USDC.e: USD Coin bridged via LayerZero (6 decimals)
 * - USDT.e: Tether USD bridged via LayerZero (6 decimals)
 * - WBTC.e: Wrapped BTC bridged via LayerZero (8 decimals)
 * - ctUSD: M^0 Protocol stablecoin (6 decimals)
 */
module.exports = class AddCitreaBridgeAssets1769475200000 {
  name = 'AddCitreaBridgeAssets1769475200000';

  async up(queryRunner) {
    // USDC.e on Citrea Mainnet (LayerZero bridged)
    await queryRunner.query(`
      INSERT INTO "dbo"."asset" (
        "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
        "comingSoon", "decimals", "paymentEnabled", "refEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
        "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo"
      ) VALUES (
        'USDC.e', 'Token', 0, 0, '0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839', 'USDC.e', 'Public', 'Citrea', 'Citrea/USDC.e', 'USD Coin (LayerZero)',
        0, 6, 0, 0, 1, 0, 0, 0, 0,
        'USD', 0, 0, 0, 0
      )
    `);

    // USDT.e on Citrea Mainnet (LayerZero bridged)
    await queryRunner.query(`
      INSERT INTO "dbo"."asset" (
        "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
        "comingSoon", "decimals", "paymentEnabled", "refEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
        "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo"
      ) VALUES (
        'USDT.e', 'Token', 0, 0, '0x9f3096Bac87e7F03DC09b0B416eB0DF837304dc4', 'USDT.e', 'Public', 'Citrea', 'Citrea/USDT.e', 'Tether USD (LayerZero)',
        0, 6, 0, 0, 1, 0, 0, 0, 0,
        'USD', 0, 0, 0, 0
      )
    `);

    // WBTC.e on Citrea Mainnet (LayerZero bridged)
    await queryRunner.query(`
      INSERT INTO "dbo"."asset" (
        "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
        "comingSoon", "decimals", "paymentEnabled", "refEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
        "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo"
      ) VALUES (
        'WBTC.e', 'Token', 0, 0, '0xDF240DC08B0FdaD1d93b74d5048871232f6BEA3d', 'WBTC.e', 'Public', 'Citrea', 'Citrea/WBTC.e', 'Wrapped BTC (LayerZero)',
        0, 8, 0, 0, 1, 0, 0, 0, 0,
        'BTC', 0, 0, 0, 0
      )
    `);

    // ctUSD on Citrea Mainnet (M^0 Protocol) - 6 decimals like M Token
    await queryRunner.query(`
      INSERT INTO "dbo"."asset" (
        "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
        "comingSoon", "decimals", "paymentEnabled", "refEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
        "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo"
      ) VALUES (
        'ctUSD', 'Token', 0, 0, '0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D', 'ctUSD', 'Public', 'Citrea', 'Citrea/ctUSD', 'M^0 Protocol USD',
        0, 6, 0, 0, 1, 0, 0, 0, 0,
        'USD', 0, 0, 0, 0
      )
    `);
  }

  async down(queryRunner) {
    await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Citrea/USDC.e'`);
    await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Citrea/USDT.e'`);
    await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Citrea/WBTC.e'`);
    await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Citrea/ctUSD'`);
  }
};
