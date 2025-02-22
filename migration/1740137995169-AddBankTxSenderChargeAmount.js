const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBankTxSenderChargeAmount1740137995169 {
    name = 'AddBankTxSenderChargeAmount1740137995169'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "senderChargeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "senderChargeCurrency" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "senderChargeAmountChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "senderChargeAmountChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "senderChargeCurrency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "senderChargeAmount"`);
    }
}
