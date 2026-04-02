module.exports = class AddArkBtcAsset1773590400000 {
    name = 'AddArkBtcAsset1773590400000'

    async up(queryRunner) {
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Arkade/BTC')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'BTC', 'Coin', 1, 1, NULL, 'BTC', 'Public', 'Arkade', 'Arkade/BTC', 'Arkade',
                0, NULL, 1, 1, 0, 0, 0, 0,
                'BTC', 0, 0, 0, 0, 11,
                NULL, NULL, NULL, NULL
            )
        `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "uniqueName" = 'Arkade/BTC'`);
    }
}
