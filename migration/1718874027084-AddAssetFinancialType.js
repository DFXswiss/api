const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAssetFinancialType1718874027084 {
    name = 'AddAssetFinancialType1718874027084'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "financialType" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "financialType"`);
    }
}
