const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class optimizeBuyCryptoFee1713916293496 {
    name = 'optimizeBuyCryptoFee1713916293496'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" ADD "allowedTotalFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" DROP COLUMN "allowedTotalFeePercent"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" ADD "allowedTotalFeePercent" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto_fee" DROP COLUMN "allowedTotalFeeAmount"`);
    }
}
