const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addPriceSteps1716379533490 {
    name = 'addPriceSteps1716379533490'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "priceSteps" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "priceSteps" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "priceSteps"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "priceSteps"`);
    }
}
