const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddPaymentQuoteWebhook1723809890294 {
    name = 'AddPaymentQuoteWebhook1723809890294'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "webhookUrl" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "webhookUrl"`);
    }
}
