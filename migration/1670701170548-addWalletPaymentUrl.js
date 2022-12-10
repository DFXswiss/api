const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addWalletPaymentUrl1670701170548 {
    name = 'addWalletPaymentUrl1670701170548'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" ADD "paymentUrl" nvarchar(256)`);
        await queryRunner.query(`EXEC sp_rename "wallet.apiUrl", "kycUrl"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."wallet" DROP COLUMN "paymentUrl"`);
        await queryRunner.query(`EXEC sp_rename "wallet.kycUrl", "apiUrl"`);
    }
}
