const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedSecondSpiderUrl1644277595687 {
    name = 'AddedSecondSpiderUrl1644277595687'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" ADD "secondUrl" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."spider_data" DROP COLUMN "secondUrl"`);
    }
}
