const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingExpectedAmount1720712636550 {
    name = 'TradingExpectedAmount1720712636550'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD "amountExpected" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ALTER COLUMN "amountOut" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ALTER COLUMN "amountOut" float NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP COLUMN "amountExpected"`);
    }
}
