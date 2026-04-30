const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedCryptoSell1643425957345 {
    name = 'AddedCryptoSell1643425957345'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "crypto_sell" ("id" int NOT NULL IDENTITY(1,1), "recipientMail" nvarchar(256), "mail1SendDate" float, "mail2SendDate" float, "mail3SendDate" float, "fee" float, "fiatReferenceAmount" float, "fiatReferenceCurrency" nvarchar(256), "amountInChf" float, "amountInEur" float, "amlCheck" nvarchar(256), "iban" nvarchar(256), "outputAmount" float, "outputCurrency" nvarchar(256), "bankUsage" nvarchar(256), "outputDate" datetime2, "updated" datetime2 NOT NULL CONSTRAINT "DF_b30259b3e53b8c9e33c4d63b5e6" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_68bcf714b2561b2b75c5f0cb183" DEFAULT getdate(), "bankTxId" int, "cryptoInputId" int NOT NULL, CONSTRAINT "PK_65ef2f49ab7c6d9bfe2ce2a65fa" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_3ee154ad2d45e51bf0cc0f1d25" ON "crypto_sell" ("bankTxId") WHERE "bankTxId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_06f65045972e0600169ba7dcfe" ON "crypto_sell" ("cryptoInputId") WHERE "cryptoInputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "amountInEur" float`);
        await queryRunner.query(`ALTER TABLE "crypto_sell" ADD CONSTRAINT "FK_3ee154ad2d45e51bf0cc0f1d251" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "crypto_sell" ADD CONSTRAINT "FK_06f65045972e0600169ba7dcfea" FOREIGN KEY ("cryptoInputId") REFERENCES "crypto_input"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "crypto_sell" DROP CONSTRAINT "FK_06f65045972e0600169ba7dcfea"`);
        await queryRunner.query(`ALTER TABLE "crypto_sell" DROP CONSTRAINT "FK_3ee154ad2d45e51bf0cc0f1d251"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "amountInEur"`);
        await queryRunner.query(`DROP INDEX "REL_06f65045972e0600169ba7dcfe" ON "crypto_sell"`);
        await queryRunner.query(`DROP INDEX "REL_3ee154ad2d45e51bf0cc0f1d25" ON "crypto_sell"`);
        await queryRunner.query(`DROP TABLE "crypto_sell"`);
    }
}
