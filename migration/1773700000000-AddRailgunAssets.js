module.exports = class AddRailgunAssets1773700000000 {
    name = 'AddRailgunAssets1773700000000'

    async up(queryRunner) {
        // Railgun/WETH — based on Ethereum/WETH (priceRule 6)
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Railgun/WETH')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'WETH', 'Token', 1, 0, '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 'WETH', 'Public', 'Railgun', 'Railgun/WETH', 'Wrapped Ether',
                0, 18, 0, 1, 0, 0, 0, 0,
                'Other', 0, 0, 0, 0, 6,
                NULL, NULL, NULL, NULL
            )
        `);

        // Railgun/USDT — based on Ethereum/USDT (priceRule 40)
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Railgun/USDT')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'USDT', 'Token', 1, 0, '0xdac17f958d2ee523a2206206994597c13d831ec7', 'USDT', 'Public', 'Railgun', 'Railgun/USDT', 'Tether',
                0, 6, 0, 1, 0, 0, 0, 0,
                'USD', 0, 0, 0, 0, 40,
                NULL, NULL, NULL, NULL
            )
        `);

        // Railgun/dEURO — based on Ethereum/dEURO (priceRule 39)
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Railgun/dEURO')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'dEURO', 'Token', 1, 0, '0xba3f535bbcccca2a154b573ca6c5a49baae0a3ea', 'dEURO', 'Public', 'Railgun', 'Railgun/dEURO', 'Decentralized EURO',
                0, 18, 0, 1, 0, 0, 0, 0,
                'EUR', 0, 0, 0, 0, 39,
                NULL, NULL, NULL, NULL
            )
        `);

        // Railgun/ZCHF — based on Ethereum/ZCHF (priceRule 2, amlRuleFrom 8)
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Railgun/ZCHF')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'ZCHF', 'Token', 1, 0, '0xb58e61c3098d85632df34eecfb899a1ed80921cb', 'ZCHF', 'Public', 'Railgun', 'Railgun/ZCHF', 'Frankencoin',
                0, 18, 0, 1, 0, 0, 0, 0,
                'CHF', 0, 0, 8, 0, 2,
                NULL, NULL, NULL, NULL
            )
        `);

        // Railgun/DAI — based on Ethereum/DAI (priceRule 4)
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Railgun/DAI')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'DAI', 'Token', 1, 0, '0x6b175474e89094c44da98b954eedeac495271d0f', 'DAI', 'Public', 'Railgun', 'Railgun/DAI', 'Dai',
                0, 18, 0, 1, 0, 0, 0, 0,
                'USD', 0, 0, 0, 0, 4,
                NULL, NULL, NULL, NULL
            )
        `);

        // Railgun/WBTC — based on Ethereum/WBTC (priceRule 34)
        await queryRunner.query(`
            IF NOT EXISTS (SELECT 1 FROM "dbo"."asset" WHERE "uniqueName" = 'Railgun/WBTC')
            INSERT INTO "dbo"."asset" (
                "name", "type", "buyable", "sellable", "chainId", "dexName", "category", "blockchain", "uniqueName", "description",
                "comingSoon", "decimals", "paymentEnabled", "refundEnabled", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable",
                "financialType", "ikna", "personalIbanEnabled", "amlRuleFrom", "amlRuleTo", "priceRuleId",
                "approxPriceUsd", "approxPriceChf", "approxPriceEur", "sortOrder"
            ) VALUES (
                'WBTC', 'Token', 1, 0, '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', 'WBTC', 'Public', 'Railgun', 'Railgun/WBTC', 'Wrapped BTC',
                0, 8, 0, 1, 0, 0, 0, 0,
                'BTC', 0, 0, 0, 0, 34,
                NULL, NULL, NULL, NULL
            )
        `);
        // --- Add all Railgun assets to base fees ---
        const feeIds = [7, 8, 10, 17, 18, 19, 26, 27, 28];
        const railgunAssets = await queryRunner.query(
            `SELECT "id" FROM "dbo"."asset" WHERE "blockchain" = 'Railgun'`,
        );

        for (const { id: assetId } of railgunAssets) {
            await queryRunner.query(`
                UPDATE "dbo"."fee"
                SET "assets" = "assets" + ';${assetId}'
                WHERE "id" IN (${feeIds.join(', ')})
                  AND ';' + "assets" + ';' NOT LIKE '%;${assetId};%'
            `);
        }
    }

    async down(queryRunner) {
        // Remove from base fees first
        const feeIds = [7, 8, 10, 17, 18, 19, 26, 27, 28];
        const railgunAssets = await queryRunner.query(
            `SELECT "id" FROM "dbo"."asset" WHERE "blockchain" = 'Railgun'`,
        );

        for (const { id: assetId } of railgunAssets) {
            await queryRunner.query(`
                UPDATE "dbo"."fee"
                SET "assets" = REPLACE("assets", ';${assetId}', '')
                WHERE "id" IN (${feeIds.join(', ')})
            `);
        }

        await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "blockchain" = 'Railgun'`);
    }
}
