const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RenamedIdentId1646746737427 {
    name = 'RenamedIdentId1646746737427'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "identId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "identTransactionId" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "identTransactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "identId" nvarchar(256)`);
    }
}
