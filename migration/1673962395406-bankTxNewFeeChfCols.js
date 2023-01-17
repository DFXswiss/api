const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class bankTxNewFeeChfCols1673962395406 {
    name = 'bankTxNewFeeChfCols1673962395406'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingAmountBeforeFeeCHF" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "accountingAmountAfterFeeCHF" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingAmountAfterFeeCHF"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "accountingAmountBeforeFeeCHF"`);
    }
}
