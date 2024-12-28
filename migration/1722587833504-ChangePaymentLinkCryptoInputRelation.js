const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class ChangePaymentLinkCryptoInputRelation1722587833504 {
    name = 'ChangePaymentLinkCryptoInputRelation1722587833504'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "FK_a31317b642d8c22787cd61dce93"`);
        await queryRunner.query(`DROP INDEX "REL_a31317b642d8c22787cd61dce9" ON "payment_link_payment"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "cryptoInputId"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD "paymentLinkPaymentId" int`);
        await queryRunner.query(`ALTER TABLE "crypto_input" ADD CONSTRAINT "FK_c236da3e9506bc76cac08832fb8" FOREIGN KEY ("paymentLinkPaymentId") REFERENCES "payment_link_payment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP CONSTRAINT "FK_c236da3e9506bc76cac08832fb8"`);
        await queryRunner.query(`ALTER TABLE "crypto_input" DROP COLUMN "paymentLinkPaymentId"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "cryptoInputId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_a31317b642d8c22787cd61dce9" ON "payment_link_payment" ("cryptoInputId") WHERE ([cryptoInputId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD CONSTRAINT "FK_a31317b642d8c22787cd61dce93" FOREIGN KEY ("cryptoInputId") REFERENCES "crypto_input"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
