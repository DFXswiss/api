const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class FeeFinancialType1729093904453 {
    name = 'FeeFinancialType1729093904453'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "financialTypes" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "financialTypes"`);
    }
}
