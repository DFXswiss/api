const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class BuyFiatChargebackAddress1724462452884 {
    name = 'BuyFiatChargebackAddress1724462452884'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_fiat.cryptoReturnTxId", "chargebackTxId"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.cryptoReturnDate", "chargebackDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "chargebackAddress" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "chargebackAddress"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.chargebackDate", "cryptoReturnDate"`);
        await queryRunner.query(`EXEC sp_rename "buy_fiat.chargebackTxId", "cryptoReturnTxId"`);
    }
}
