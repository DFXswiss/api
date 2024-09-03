const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class HexEndpoint1725348870382 {
    name = 'HexEndpoint1725348870382'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "standard" nvarchar(256) NOT NULL CONSTRAINT "DF_09b2f8c6e412cbdaaa9ac704ce1" DEFAULT 'OpenCryptoPay'`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "tx" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "txId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "errorMessage" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD "standard" nvarchar(256) NOT NULL CONSTRAINT "DF_ee2feac2b789df65501547338b5" DEFAULT 'OpenCryptoPay'`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD "quoteId" int`);
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "config" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "paymentLinksConfig" nvarchar(MAX)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_175c17fcf3544d29a07f75b51b" ON "payment_activation" ("method", "assetId", "amount") WHERE status = 'Pending' AND standard = 'PayToAddress'`);
        await queryRunner.query(`ALTER TABLE "payment_activation" ADD CONSTRAINT "FK_cc0e305241cc6001264d658ff68" FOREIGN KEY ("quoteId") REFERENCES "payment_quote"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP CONSTRAINT "FK_cc0e305241cc6001264d658ff68"`);
        await queryRunner.query(`DROP INDEX "IDX_175c17fcf3544d29a07f75b51b" ON "payment_activation"`);
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "paymentLinksConfig"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "config"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP COLUMN "quoteId"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP CONSTRAINT "DF_ee2feac2b789df65501547338b5"`);
        await queryRunner.query(`ALTER TABLE "payment_activation" DROP COLUMN "standard"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "errorMessage"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "txId"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "tx"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP CONSTRAINT "DF_09b2f8c6e412cbdaaa9ac704ce1"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "standard"`);
    }
}
