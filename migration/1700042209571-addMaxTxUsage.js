const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addMaxTxUsage1700042209571 {
    name = 'addMaxTxUsage1700042209571'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "usedFeeIds" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "usedFeeIds" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "usages" float NOT NULL CONSTRAINT "DF_a2132c4a6848fad89fe3980b016" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "maxTxUsages" float`);
        await queryRunner.query(`ALTER TABLE "fee" ADD "txUsages" float NOT NULL CONSTRAINT "DF_d8bd14f4371b371b6861d845cd8" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "DF_d8bd14f4371b371b6861d845cd8"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "txUsages"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "maxTxUsages"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "DF_a2132c4a6848fad89fe3980b016"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "usages"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "usedFeeIds"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "usedFeeIds"`);
    }
}
