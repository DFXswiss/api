const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddIdentPdf1653675386990 {
    name = 'AddIdentPdf1653675386990'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" ADD "identPdf" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "spider_data" DROP COLUMN "identPdf"`);
    }
}
