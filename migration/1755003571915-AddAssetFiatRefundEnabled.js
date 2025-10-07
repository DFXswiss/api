const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAssetFiatRefundEnabled1755003571915 {
    name = 'AddAssetFiatRefundEnabled1755003571915'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "refundEnabled" bit NOT NULL CONSTRAINT "DF_6e34432dae0d768cd9cbc52df7d" DEFAULT 1`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "refundEnabled" bit NOT NULL CONSTRAINT "DF_395dddfae793d13fd8ee6dbf2f5" DEFAULT 1`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_395dddfae793d13fd8ee6dbf2f5"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "refundEnabled"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_6e34432dae0d768cd9cbc52df7d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "refundEnabled"`);
    }
}
