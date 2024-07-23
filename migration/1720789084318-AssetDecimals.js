const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AssetDecimals1720789084318 {
    name = 'AssetDecimals1720789084318'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "decimals" int`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "decimals"`);
    }
}
