const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addLimitRequestCols1663942486233 {
    name = 'addLimitRequestCols1663942486233'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "decision" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "clerk" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" ADD "edited" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "edited"`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "clerk"`);
        await queryRunner.query(`ALTER TABLE "dbo"."limit_request" DROP COLUMN "decision"`);
    }
}
