const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSepoliaUSDT1767291858000 {
    name = 'AddSepoliaUSDT1767291858000'

    async up(queryRunner) {
        await queryRunner.query(`
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur"
            ) VALUES (
                'USDT', 'Token', 0, 1, '0xaa8e23fb1079ea71e0a56f48a2aa51851d8433d0', 'USDT', 'Public', 'Sepolia', 'Sepolia/USDT', 'Tether',
                0, 6, 0, 1, 0, 0, 0, 0,
                'USD', 0, 0, 0, 0, 40,
                1, 0.78851, 0.849
            )
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Sepolia/USDT'`);
    }
}
