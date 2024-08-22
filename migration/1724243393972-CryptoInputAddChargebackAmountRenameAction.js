const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoInputAddChargebackAmountRenameAction1724243393972 {
    name = 'CryptoInputAddChargebackAmountRenameAction1724243393972'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "amlCheck"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.sendType", "action"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "chargebackAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "chargebackAmount"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.action", "sendType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "amlCheck" nvarchar(256)`);
    }
}
