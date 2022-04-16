const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddSpiderExport1650105288039 {
    name = 'AddSpiderExport1650105288039'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" ADD "chatbotExport" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" DROP COLUMN "chatbotExport"`);
    }
}
