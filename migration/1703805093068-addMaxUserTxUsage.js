const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addMaxUserTxUsage1703805093068 {
    name = 'addMaxUserTxUsage1703805093068'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "maxUserTxUsages" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "userTxUsages" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "userTxUsages"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "maxUserTxUsages"`);
    }
}
