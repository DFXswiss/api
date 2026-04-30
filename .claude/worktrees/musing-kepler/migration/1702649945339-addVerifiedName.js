const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addVerifiedName1702649945339 {
    name = 'addVerifiedName1702649945339'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "verifiedName" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "verifiedName"`);
    }
}
