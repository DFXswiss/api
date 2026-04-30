const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeBankAccountBuySell1732015898509 {
    name = 'removeBankAccountBuySell1732015898509'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "FK_14b7c5eab01c490849dba4c2917"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_387be31cb4b12c7e8dcd6485d50"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP COLUMN "bankAccountId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "bankAccountId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" DROP COLUMN "bankDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "CHK_63f039f3dd10b45907506d8479" CHECK ("active" = 0 OR "bankDataId" IS NOT NULL OR "type" <> 'Sell')`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" DROP CONSTRAINT "CHK_63f039f3dd10b45907506d8479"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "bankDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD "bankAccountId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD "bankAccountId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_b904235a2b69d309f4a88d07ecf" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy" ADD CONSTRAINT "FK_387be31cb4b12c7e8dcd6485d50" FOREIGN KEY ("bankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit_route" ADD CONSTRAINT "FK_14b7c5eab01c490849dba4c2917" FOREIGN KEY ("bankAccountId") REFERENCES "bank_account"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
