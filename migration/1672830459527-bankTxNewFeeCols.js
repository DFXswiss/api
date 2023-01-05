const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankTxNewFeeCols1672830459527 {
    name = 'bankTxNewFeeCols1672830459527'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingAmountBeforeFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingFeePercent" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingAmountAfterFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingAmountAfterFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingFeePercent"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingAmountBeforeFee"`);
    }
}
