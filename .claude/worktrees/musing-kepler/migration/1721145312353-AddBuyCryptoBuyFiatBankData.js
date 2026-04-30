const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBuyCryptoBuyFiatBankData1721145312353 {
    name = 'AddBuyCryptoBuyFiatBankData1721145312353'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "bankDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "bankDataId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_ac14ac0ce8d0497a88c50657039" FOREIGN KEY ("bankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_49f0887149ba4607ce984b6dd7c" FOREIGN KEY ("bankDataId") REFERENCES "bank_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_49f0887149ba4607ce984b6dd7c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_ac14ac0ce8d0497a88c50657039"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "bankDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "bankDataId"`);
    }
}
