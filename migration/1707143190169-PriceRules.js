const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PriceRules1707143190169 {
    name = 'PriceRules1707143190169'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "price_rule" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_f2d58cd1752e0c0e4d84e31995f" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_da91172ae85f565056df6d8c8a3" DEFAULT getdate(), "priceSource" nvarchar(255) NOT NULL, "priceAsset" nvarchar(255) NOT NULL, "priceReference" nvarchar(255) NOT NULL, "check1Source" nvarchar(255), "check1Asset" nvarchar(255), "check1Reference" nvarchar(255), "check1Limit" float, "check2Source" nvarchar(255), "check2Asset" nvarchar(255), "check2Reference" nvarchar(255), "check2Limit" float, "currentPrice" float, "priceValiditySeconds" int NOT NULL, "priceTimestamp" datetime2, "referenceId" int NOT NULL, CONSTRAINT "PK_90db7c1255d7388d329842ab10b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "priceRuleId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "priceRuleId" int`);
        await queryRunner.query(`ALTER TABLE "price_rule" ADD CONSTRAINT "FK_85d63658ee8348a72cc5704f9f5" FOREIGN KEY ("referenceId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD CONSTRAINT "FK_498338cbab828a1938e283a16d4" FOREIGN KEY ("priceRuleId") REFERENCES "price_rule"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD CONSTRAINT "FK_ca38f80938e6586c36e4dc57374" FOREIGN KEY ("priceRuleId") REFERENCES "price_rule"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "FK_ca38f80938e6586c36e4dc57374"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "FK_498338cbab828a1938e283a16d4"`);
        await queryRunner.query(`ALTER TABLE "price_rule" DROP CONSTRAINT "FK_85d63658ee8348a72cc5704f9f5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "priceRuleId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "priceRuleId"`);
        await queryRunner.query(`DROP TABLE "price_rule"`);
    }
}
