const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingAmountOut1711103926691 {
    name = 'TradingAmountOut1711103926691'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD "amountOut" float NOT NULL CONSTRAINT "DF_d18fcc16f8aab08733299e22017" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP CONSTRAINT "DF_d18fcc16f8aab08733299e22017"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP COLUMN "amountOut"`);
    }
}
