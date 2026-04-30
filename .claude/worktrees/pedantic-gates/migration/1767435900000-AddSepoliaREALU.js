const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSepoliaREALU1767435900000 {
    name = 'AddSepoliaREALU1767435900000'

    async up(queryRunner) {
        await queryRunner.query(`
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'REALU', 'Token', 0, 0, '0x0add9824820508dd7992cbebb9f13fbe8e45a30f', 'REALU', 'Public', 'Sepolia', 'Sepolia/REALU', 'RealUnit Shares (Testnet)',
                0, 0, 0, 1, 0, 0, 0, 0,
                'Other', 0, 0, 0, 0, 61,
                1.711564371, 1.349572115, 1.453103607, 99
            )
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Sepolia/REALU'`);
    }
}
