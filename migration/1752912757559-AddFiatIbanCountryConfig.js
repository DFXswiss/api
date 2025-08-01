const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFiatIbanCountryConfig1752912757559 {
    name = 'AddFiatIbanCountryConfig1752912757559'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "ibanCountryConfig" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "ibanCountryConfig"`);
    }
}
