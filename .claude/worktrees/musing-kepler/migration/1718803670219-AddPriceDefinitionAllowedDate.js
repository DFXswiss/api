const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddPriceDefinitionAllowedDate1718803670219 {
    name = 'AddPriceDefinitionAllowedDate1718803670219'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "priceDefinitionAllowedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "priceDefinitionAllowedDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "priceDefinitionAllowedDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "priceDefinitionAllowedDate"`);
    }
}
