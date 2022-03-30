const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RefactoringBankTxCryptoInputMapping1648658611672 {
    name = 'RefactoringBankTxCryptoInputMapping1648658611672'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "crypto_input.isReturned", "returnTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_b4e6db6a5e7c13d9729e19ead3d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "DF_a95219002cdb6da1da4cfe845ce" DEFAULT 0 FOR "returnTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP CONSTRAINT "DF_afcbfe71e7fc5bdd9000227d582"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" DROP COLUMN "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" DROP CONSTRAINT "DF_ead18e6ba181b0da11882e3bed6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" DROP COLUMN "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "txType"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "inReturnBankTxId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "nextRepeatBankTxId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_a95219002cdb6da1da4cfe845ce"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "returnTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "returnTxId" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_097e693b22033f81dc3695dd32" ON "dbo"."bank_tx" ("inReturnBankTxId") WHERE "inReturnBankTxId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_3c264ac8b76bdf550c5870c356" ON "dbo"."bank_tx" ("nextRepeatBankTxId") WHERE "nextRepeatBankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_097e693b22033f81dc3695dd327" FOREIGN KEY ("inReturnBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_3c264ac8b76bdf550c5870c3562" FOREIGN KEY ("nextRepeatBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_3c264ac8b76bdf550c5870c3562"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_097e693b22033f81dc3695dd327"`);
        await queryRunner.query(`DROP INDEX "REL_3c264ac8b76bdf550c5870c356" ON "dbo"."bank_tx"`);
        await queryRunner.query(`DROP INDEX "REL_097e693b22033f81dc3695dd32" ON "dbo"."bank_tx"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "returnTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "returnTxId" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "DF_a95219002cdb6da1da4cfe845ce" DEFAULT 0 FOR "returnTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "nextRepeatBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "inReturnBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "txType" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" ADD "isReturned" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_sell" ADD CONSTRAINT "DF_ead18e6ba181b0da11882e3bed6" DEFAULT 0 FOR "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD "isReturned" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_buy" ADD CONSTRAINT "DF_afcbfe71e7fc5bdd9000227d582" DEFAULT 0 FOR "isReturned"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "DF_a95219002cdb6da1da4cfe845ce"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "DF_b4e6db6a5e7c13d9729e19ead3d" DEFAULT 0 FOR "returnTxId"`);
        await queryRunner.query(`EXEC sp_rename "crypto_input.returnTxId", "isReturned"`);
    }
}
