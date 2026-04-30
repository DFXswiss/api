const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBuyCryptoChargebackTxId1686151116788 {
    name = 'addBuyCryptoChargebackTxId1686151116788'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackCryptoTxId" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackCryptoTxId"`);
    }
}
