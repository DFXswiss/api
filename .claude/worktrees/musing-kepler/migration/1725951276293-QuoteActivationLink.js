const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class QuoteActivationLink1725951276293 {
    name = 'QuoteActivationLink1725951276293'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD "paymentHash" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD "quoteId" int`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD CONSTRAINT "FK_cc0e305241cc6001264d658ff68" FOREIGN KEY ("quoteId") REFERENCES "payment_quote"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP CONSTRAINT "FK_cc0e305241cc6001264d658ff68"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP COLUMN "quoteId"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP COLUMN "paymentHash"`);
    }
}
