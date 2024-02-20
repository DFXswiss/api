const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class FiatChfPrice1708443094666 {
    name = 'FiatChfPrice1708443094666'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "approxPriceChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "approxPriceChf"`);
    }
}
