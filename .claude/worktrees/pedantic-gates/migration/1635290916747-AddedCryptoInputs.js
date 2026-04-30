const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedCryptoInputs1635290916747 {
    name = 'AddedCryptoInputs1635290916747'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "crypto_input" ("id" int NOT NULL IDENTITY(1,1), "inTxId" nvarchar(256) NOT NULL, "outTxId" nvarchar(256) NOT NULL, "blockHeight" int NOT NULL, "amount" float NOT NULL, "updated" datetime2 NOT NULL CONSTRAINT "DF_1d7ec65d391981cf582512a0c4d" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_0d5c651a61d93db6f5fe31cfce7" DEFAULT getdate(), "f1" nvarchar(256), "f2" nvarchar(256), "f3" nvarchar(256), "f4" nvarchar(256), "f5" nvarchar(256), "f6" nvarchar(256), "f7" nvarchar(256), "f8" nvarchar(256), "f9" nvarchar(256), "f10" nvarchar(256), "f11" nvarchar(256), "f12" nvarchar(256), "f13" nvarchar(256), "f14" nvarchar(256), "f15" nvarchar(256), "f16" nvarchar(256), "f17" nvarchar(256), "f18" nvarchar(256), "f19" nvarchar(256), "f20" nvarchar(256), "f21" nvarchar(256), "f22" nvarchar(256), "f23" nvarchar(256), "f24" nvarchar(256), "f25" nvarchar(256), "f26" nvarchar(256), "f27" nvarchar(256), "f28" nvarchar(256), "f29" nvarchar(256), "f30" nvarchar(256), "assetId" int NOT NULL, "sellId" int NOT NULL, CONSTRAINT "PK_ba23e061b9f1ed951baaa500d39" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "txAssetSell" ON "crypto_input" ("inTxId", "assetId", "sellId") `);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_3e0f683d5bf0777f30b143db787" FOREIGN KEY ("assetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_8ca9429a424c15ce5e6ce104b17" FOREIGN KEY ("sellId") REFERENCES "sell"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_8ca9429a424c15ce5e6ce104b17"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_3e0f683d5bf0777f30b143db787"`);
        await queryRunner.query(`DROP INDEX "txAssetSell" ON "crypto_input"`);
        await queryRunner.query(`DROP TABLE "crypto_input"`);
    }
}
