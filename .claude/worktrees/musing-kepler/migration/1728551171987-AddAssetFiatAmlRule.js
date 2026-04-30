const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAssetFiatAmlRule1728551171987 {
    name = 'AddAssetFiatAmlRule1728551171987'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."asset" ADD "amlRule" int NOT NULL CONSTRAINT "DF_cf9639865503f5add1847ceb23b" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" ADD "amlRule" int NOT NULL CONSTRAINT "DF_314f15a0c0792a8efa07a3be936" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP CONSTRAINT "DF_314f15a0c0792a8efa07a3be936"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat" DROP COLUMN "amlRule"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP CONSTRAINT "DF_cf9639865503f5add1847ceb23b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."asset" DROP COLUMN "amlRule"`);
    }
}
