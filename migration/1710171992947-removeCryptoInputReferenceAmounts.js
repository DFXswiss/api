const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeCryptoInputReferenceAmounts1710171992947 {
    name = 'removeCryptoInputReferenceAmounts1710171992947'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "btcAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "usdtAmount"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "usdtAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "btcAmount" float`);
    }
}
