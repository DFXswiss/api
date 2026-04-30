const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RemoveBankTxSenderChargeAmountChf1755198286446 {
    name = 'RemoveBankTxSenderChargeAmountChf1755198286446'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "senderChargeAmountChf"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "senderChargeAmountChf" float`);
    }
}
