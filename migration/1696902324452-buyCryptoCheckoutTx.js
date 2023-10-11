const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyCryptoCheckoutTx1696902324452 {
    name = 'buyCryptoCheckoutTx1696902324452'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "checkoutTxId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_f716b4602b5aa4feb64d6f553f" ON "dbo"."buy_crypto" ("checkoutTxId") WHERE "checkoutTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_f716b4602b5aa4feb64d6f553f3" FOREIGN KEY ("checkoutTxId") REFERENCES "checkout_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_f716b4602b5aa4feb64d6f553f3"`);
        await queryRunner.query(`DROP INDEX "REL_f716b4602b5aa4feb64d6f553f" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "checkoutTxId"`);
    }
}
