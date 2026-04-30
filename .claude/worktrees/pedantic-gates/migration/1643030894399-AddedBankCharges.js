const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBankCharges1643030894399 {
    name = 'AddedBankCharges1643030894399'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "chargeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "chargeCurrency" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "chargeCurrency"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "chargeAmount"`);
    }
}
