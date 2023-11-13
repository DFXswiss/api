const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addAddtionalFee1699464913349 {
    name = 'addAddtionalFee1699464913349'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" ADD "fixed" float NOT NULL CONSTRAINT "DF_3fa79721ce212a232a6c12c376b" DEFAULT 0`);
        await queryRunner.query(`EXEC sp_rename "fee.value", "rate"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP CONSTRAINT "DF_3fa79721ce212a232a6c12c376b"`);
        await queryRunner.query(`ALTER TABLE "dbo"."fee" DROP COLUMN "fixed"`);
        await queryRunner.query(`EXEC sp_rename "fee.rate", "value"`);
    }
}
