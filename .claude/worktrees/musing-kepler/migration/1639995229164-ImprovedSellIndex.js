const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ImprovedSellIndex1639995229164 {
    name = 'ImprovedSellIndex1639995229164'

    async up(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanFiat" ON "dbo"."sell"`);
        await queryRunner.query(`DROP INDEX "ibanAddressAsset" ON "dbo"."buy"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "address"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanFiatUser" ON "dbo"."sell" ("iban", "fiatId", "userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAssetUser" ON "dbo"."buy" ("iban", "assetId", "userId") `);
    }

    async down(queryRunner) {
        await queryRunner.query(`DROP INDEX "ibanAssetUser" ON "dbo"."buy"`);
        await queryRunner.query(`DROP INDEX "ibanFiatUser" ON "dbo"."sell"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "address" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanAddressAsset" ON "dbo"."buy" ("iban", "assetId", "userId") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "ibanFiat" ON "dbo"."sell" ("iban", "fiatId") `);
    }
}
