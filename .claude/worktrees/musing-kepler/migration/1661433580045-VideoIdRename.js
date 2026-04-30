const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class VideoIdRename1661433580045 {
    name = 'VideoIdRename1661433580045'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "dbo.spider_data.identTransactionId", "identIdentificationIds"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "dbo.spider_data.identIdentificationIds", "identTransactionId"`);
    }
}
