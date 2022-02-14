const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AdaptedSpiderData1644845249891 {
    name = 'AdaptedSpiderData1644845249891'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contributionCurrency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contribution" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" DROP COLUMN "contribution"`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionCurrency" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."user_data" ADD "contributionAmount" int`);
    }
}
