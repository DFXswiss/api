const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LimitRequestTextLength1710952208059 {
    name = 'LimitRequestTextLength1710952208059'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ALTER COLUMN "fundOriginText" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ALTER COLUMN "fundOriginText" nvarchar(256)`);
    }
}
