const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankAccountNotNullable1656549565635 {
    name = 'bankAccountNotNullable1656549565635'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "bankAccountId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ALTER COLUMN "bankAccountId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
