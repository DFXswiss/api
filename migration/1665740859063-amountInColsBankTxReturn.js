const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class amountInColsBankTxReturn1665740859063 {
    name = 'amountInColsBankTxReturn1665740859063'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "amountInChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "amountInEur" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "amountInUsd" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "amountInUsd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "amountInEur"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "amountInChf"`);
    }
}
