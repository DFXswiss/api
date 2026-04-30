const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankTxNewFeeChfCols1673962395406 {
    name = 'bankTxNewFeeChfCols1673962395406'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingAmountBeforeFeeChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingAmountAfterFeeChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingAmountAfterFeeChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingAmountBeforeFeeChf"`);
    }
}
