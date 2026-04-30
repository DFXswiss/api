const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AssetChfPrice1708438339667 {
    name = 'AssetChfPrice1708438339667'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "approxPriceChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "approxPriceChf"`);
    }
}
