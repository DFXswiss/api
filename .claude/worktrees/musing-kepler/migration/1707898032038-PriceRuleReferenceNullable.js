const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PriceRuleReferenceNullable1707898032038 {
    name = 'PriceRuleReferenceNullable1707898032038'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."price_rule" DROP CONSTRAINT "FK_85d63658ee8348a72cc5704f9f5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."price_rule" ALTER COLUMN "referenceId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."price_rule" ADD CONSTRAINT "FK_85d63658ee8348a72cc5704f9f5" FOREIGN KEY ("referenceId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."price_rule" DROP CONSTRAINT "FK_85d63658ee8348a72cc5704f9f5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."price_rule" ALTER COLUMN "referenceId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."price_rule" ADD CONSTRAINT "FK_85d63658ee8348a72cc5704f9f5" FOREIGN KEY ("referenceId") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
