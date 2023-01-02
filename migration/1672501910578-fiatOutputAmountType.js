const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class fiatOutputAmountType1672501910578 {
    name = 'fiatOutputAmountType1672501910578'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat_output" DROP COLUMN "amount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat_output" ADD "amount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat_output" DROP COLUMN "amount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat_output" ADD "amount" int`);
    }
}
