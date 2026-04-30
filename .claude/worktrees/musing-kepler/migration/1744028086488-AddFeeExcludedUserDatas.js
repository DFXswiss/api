const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFeeExcludedUserDatas1744028086488 {
    name = 'AddFeeExcludedUserDatas1744028086488'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "excludedUserDatas" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "excludedUserDatas"`);
    }
}
