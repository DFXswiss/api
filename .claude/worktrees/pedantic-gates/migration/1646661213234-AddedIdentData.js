const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedIdentData1646661213234 {
    name = 'AddedIdentData1646661213234'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "spider_data.result", "chatbotResult"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "identId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "identResult" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "identResult"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "identId"`);
        await queryRunner.query(`EXEC sp_rename "spider_data.chatbotResult", "result"`);
    }
}
