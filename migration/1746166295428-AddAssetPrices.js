module.exports = class AddAssetPrices1746166295428 {
    name = 'AddAssetPrices1746166295428'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "asset_price" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_63cd4d02b065d41f0c13ad1875a" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_771d38b305c71bee52a5206eeb8" DEFAULT getdate(), "priceEur" float NOT NULL, "priceUsd" float NOT NULL, "priceChf" float NOT NULL, "assetId" int, CONSTRAINT "PK_66aefc74194b50b3f97e6a1ad8d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "asset_price" ADD CONSTRAINT "FK_364aab8734cdeb697f69d0fa2f2" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "asset_price" DROP CONSTRAINT "FK_364aab8734cdeb697f69d0fa2f2"`);
        await queryRunner.query(`DROP TABLE "asset_price"`);
    }
}
