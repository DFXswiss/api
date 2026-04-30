const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingAmountInNullable1721121807418 {
    name = 'TradingAmountInNullable1721121807418'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ALTER COLUMN "amountIn" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ALTER COLUMN "amountIn" float NOT NULL`);
    }
}
