const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class CryptoInputPaymentQuote1725997902507 {
    name = 'CryptoInputPaymentQuote1725997902507'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "paymentQuoteId" int`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_4a40ddce088ae470c31b72ac18a" FOREIGN KEY ("paymentQuoteId") REFERENCES "payment_quote"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_4a40ddce088ae470c31b72ac18a"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "paymentQuoteId"`);
    }
}
