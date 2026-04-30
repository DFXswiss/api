const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingFee1721648314972 {
    name = 'TradingFee1721648314972'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD "price3" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD "feeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD "feeAmountChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP COLUMN "feeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP COLUMN "feeAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP COLUMN "price3"`);
    }
}
