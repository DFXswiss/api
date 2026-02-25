module.exports = class AddSepoliaZCHF1771500000000 {
    name = 'AddSepoliaZCHF1771500000000'

    async up(queryRunner) {
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Sepolia/ZCHF')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'ZCHF', 'Token', 0, 0, '0xd3117681ca462268048f57d106d312ba0b1215ea', 'ZCHF', 'Public', 'Sepolia', 'Sepolia/ZCHF', 'Frankencoin',
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
