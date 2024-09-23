const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TradingSwapFee1726840507343 {
    name = 'TradingSwapFee1726840507343'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "trading_order.feeAmount", "txFeeAmount"`);
        await queryRunner.query(`EXEC sp_rename "trading_order.feeAmountChf", "txFeeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "trading_order" ADD "swapFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "trading_order" ADD "swapFeeAmountChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "trading_order" DROP COLUMN "swapFeeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "trading_order" DROP COLUMN "swapFeeAmount"`);
        await queryRunner.query(`EXEC sp_rename "trading_order.txFeeAmount", "feeAmount"`);
        await queryRunner.query(`EXEC sp_rename "trading_order.txFeeAmountChf", "feeAmountChf"`);
    }
}
