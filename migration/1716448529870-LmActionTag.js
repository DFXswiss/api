const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class LmActionTag1716448529870 {
    name = 'LmActionTag1716448529870'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_action" ADD "tag" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."liquidity_management_action" DROP COLUMN "tag"`);
    }
}
