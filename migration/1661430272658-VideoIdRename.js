const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class VideoIdRename1661430272658 {
    name = 'VideoIdRename1661430272658'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "dbo.spider_data.identTransactionId", "identIdentificationId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "dbo.spider_data.identIdentificationId", "identTransactionId"`);
    }
}
