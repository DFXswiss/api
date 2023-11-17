const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addApiKey1700237877955 {
    name = 'addApiKey1700237877955'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "apiKey" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "apiKey"`);
    }
}
