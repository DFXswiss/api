const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSepoliaZCHF1771500000000 {
    name = 'AddSepoliaZCHF1771500000000'

    async up(queryRunner) {
        await queryRunner.query(`
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'ZCHF', 'Token', 0, 0, '0xd8a8830a51d56eb0c43a8e0fb5124d45f07d9e2b', 'ZCHF', 'Public', 'Sepolia', 'Sepolia/ZCHF', 'Frankencoin (Testnet)',
                0, 18, 0, 0, 0, 0, 0, 0,
                'Other', 0, 0, 0, 0, NULL,
                1.0, 1.0, 0.93, 99
            )
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Sepolia/ZCHF'`);
    }
}
