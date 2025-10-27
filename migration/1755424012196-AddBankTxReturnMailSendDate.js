const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBankTxReturnMailSendDate1755424012196 {
    name = 'AddBankTxReturnMailSendDate1755424012196'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "recipientMail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "mailSendDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "mailSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "recipientMail"`);
    }
}
