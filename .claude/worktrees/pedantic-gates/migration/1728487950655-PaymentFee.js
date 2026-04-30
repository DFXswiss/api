const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentFee1728487950655 {
    name = 'PaymentFee1728487950655'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "paymentLinkFee" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "paymentLinkFee" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "paymentLinkFee"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "paymentLinkFee"`);
    }
}
