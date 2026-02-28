const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddRaiffeisenBankAssets1772303358000 {
    name = 'AddRaiffeisenBankAssets1772303358000'

    async up(queryRunner) {
        // Insert Raiffeisen EUR asset
        await queryRunner.query(`
            SET IDENTITY_INSERT "dbo"."asset" ON;
            INSERT INTO "dbo"."asset" ("id", "name", "type", "buyable", "sellable", "dexName", "category", "blockchain", "uniqueName", "comingSoon", "ikna", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable", "financialType", "paymentEnabled", "amlRuleFrom", "amlRuleTo", "refundEnabled", "refEnabled")
            VALUES (420, 'EUR', 'Custody', 0, 0, 'EUR', 'Private', 'Raiffeisen', 'Raiffeisen/EUR', 0, 0, 0, 0, 0, 0, 'EUR', 0, 0, 0, 1, 0);
            SET IDENTITY_INSERT "dbo"."asset" OFF;
        `);

        // Insert Raiffeisen CHF asset
        await queryRunner.query(`
            SET IDENTITY_INSERT "dbo"."asset" ON;
            INSERT INTO "dbo"."asset" ("id", "name", "type", "buyable", "sellable", "dexName", "category", "blockchain", "uniqueName", "comingSoon", "ikna", "cardBuyable", "cardSellable", "instantBuyable", "instantSellable", "financialType", "paymentEnabled", "amlRuleFrom", "amlRuleTo", "refundEnabled", "refEnabled")
            VALUES (421, 'CHF', 'Custody', 0, 0, 'CHF', 'Private', 'Raiffeisen', 'Raiffeisen/CHF', 0, 0, 0, 0, 0, 0, 'CHF', 0, 0, 0, 1, 0);
            SET IDENTITY_INSERT "dbo"."asset" OFF;
        `);

        // Link bank 12 (Raiffeisen EUR) to asset 420
        await queryRunner.query(`UPDATE "dbo"."bank" SET "assetId" = 420 WHERE "id" = 12`);

        // Link bank 13 (Raiffeisen CHF) to asset 421
        await queryRunner.query(`UPDATE "dbo"."bank" SET "assetId" = 421 WHERE "id" = 13`);
    }

    async down(queryRunner) {
        // Unlink banks
        await queryRunner.query(`UPDATE "dbo"."bank" SET "assetId" = NULL WHERE "id" IN (12, 13)`);

        // Remove Raiffeisen assets
        await queryRunner.query(`DELETE FROM "dbo"."asset" WHERE "id" IN (420, 421)`);
    }
}
