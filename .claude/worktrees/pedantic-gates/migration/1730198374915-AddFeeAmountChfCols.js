const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFeeAmountChfCols1730198374915 {
    name = 'AddFeeAmountChfCols1730198374915'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "forwardFeeAmountChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "chargeAmountChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."exchange_tx" ADD "feeAmountChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" ADD "profitChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."payout_order" ADD "preparationFeeAmountChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."payout_order" ADD "payoutFeeAmountChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."payout_order" DROP COLUMN "payoutFeeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."payout_order" DROP COLUMN "preparationFeeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."trading_order" DROP COLUMN "profitChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."exchange_tx" DROP COLUMN "feeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "chargeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "forwardFeeAmountChf"`);
    }
}
