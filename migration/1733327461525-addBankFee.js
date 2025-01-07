const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankFee1733327461525 {
    name = 'addBankFee1733327461525'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "bankFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "bankFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "bankId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD CONSTRAINT "FK_ff542196d21cf9fac32b0ffba80" FOREIGN KEY ("bankId") REFERENCES "bank"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "FK_ff542196d21cf9fac32b0ffba80"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "bankId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "bankFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "bankFeeAmount"`);
    }
}
