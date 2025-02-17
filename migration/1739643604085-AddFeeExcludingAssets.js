const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFeeExcludingAssets1739643604085 {
    name = 'AddFeeExcludingAssets1739643604085'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "excludedAssets" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "excludedAssets"`);
    }
}
