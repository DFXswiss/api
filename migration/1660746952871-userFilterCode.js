const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class userFilterCode1660746952871 {
    name = 'userFilterCode1660746952871'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" ADD "apiKeyFilterCT" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user" DROP COLUMN "apiKeyFilterCT"`);
    }
}
