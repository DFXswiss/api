const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddCountryKycDocuments1754317487660 {
    name = 'AddCountryKycDocuments1754317487660'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" ADD "enabledKycDocuments" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."country" DROP COLUMN "enabledKycDocuments"`);
    }
}
