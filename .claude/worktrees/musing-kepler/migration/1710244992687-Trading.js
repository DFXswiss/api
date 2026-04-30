const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class Trading1710244992687 {
    name = 'Trading1710244992687'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "trading_rule" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_3aa79af711c3ad11b8cf6ebe469" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_efa21157dca1ac8e9a2a5709025" DEFAULT getdate(), "status" nvarchar(255) NOT NULL, "source1" nvarchar(255) NOT NULL, "leftAsset1" nvarchar(255) NOT NULL, "rightAsset1" nvarchar(255) NOT NULL, "source2" nvarchar(255) NOT NULL, "leftAsset2" nvarchar(255) NOT NULL, "rightAsset2" nvarchar(255) NOT NULL, "lowerLimit" float NOT NULL, "upperLimit" float NOT NULL, "reactivationTime" int, "leftAssetId" int NOT NULL, "rightAssetId" int NOT NULL, CONSTRAINT "PK_342e00dbe72f9308c0cefbfa71b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "trading_order" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_63442f81c43e68df24df19f3f8d" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_280bd108621ace81e32f26d2245" DEFAULT getdate(), "status" nvarchar(255) NOT NULL, "price1" float NOT NULL, "price2" float NOT NULL, "priceImpact" float NOT NULL, "amountIn" float NOT NULL, "txId" nvarchar(255), "errorMessage" nvarchar(MAX), "tradingRuleId" int NOT NULL, "assetInId" int NOT NULL, "assetOutId" int NOT NULL, CONSTRAINT "PK_c6f0a889fcf3b21f8c643297f15" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "trading_rule" ADD CONSTRAINT "FK_182ba779e56cf5e1c2db258b786" FOREIGN KEY ("leftAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trading_rule" ADD CONSTRAINT "FK_8b9f4655138aacdcdefa85f9484" FOREIGN KEY ("rightAssetId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trading_order" ADD CONSTRAINT "FK_f862025cb7ca5a2d66d14fb89a1" FOREIGN KEY ("tradingRuleId") REFERENCES "trading_rule"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trading_order" ADD CONSTRAINT "FK_a01e680fa2dd6cc0ef3e2bf5623" FOREIGN KEY ("assetInId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "trading_order" ADD CONSTRAINT "FK_b5d03233e434d71b6996838da2c" FOREIGN KEY ("assetOutId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trading_order" DROP CONSTRAINT "FK_b5d03233e434d71b6996838da2c"`);
        await queryRunner.query(`ALTER TABLE "trading_order" DROP CONSTRAINT "FK_a01e680fa2dd6cc0ef3e2bf5623"`);
        await queryRunner.query(`ALTER TABLE "trading_order" DROP CONSTRAINT "FK_f862025cb7ca5a2d66d14fb89a1"`);
        await queryRunner.query(`ALTER TABLE "trading_rule" DROP CONSTRAINT "FK_8b9f4655138aacdcdefa85f9484"`);
        await queryRunner.query(`ALTER TABLE "trading_rule" DROP CONSTRAINT "FK_182ba779e56cf5e1c2db258b786"`);
        await queryRunner.query(`DROP TABLE "trading_order"`);
        await queryRunner.query(`DROP TABLE "trading_rule"`);
    }
}
