const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyCrypto1650799366623 {
    name = 'buyCrypto1650799366623'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "buy_crypto" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_ca289a5a40aa826752c24e5c756" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_3d1a83c2a2fb1726ba6b655aa0b" DEFAULT getdate(), "inputAmount" float, "inputAsset" nvarchar(256), "inputReferenceAmount" float, "inputReferenceAsset" nvarchar(256), "amountInChf" float, "amountInEur" float, "amlCheck" nvarchar(256), "fee" float, "inputReferenceAmountMinusFee" float, "outputReferenceAmount" float, "outputReferenceAsset" nvarchar(256), "outputAmount" float, "outputAsset" nvarchar(256), "txId" nvarchar(256), "outputDate" datetime2, "recipientMail" nvarchar(256), "mailSendDate" float, "usedRef" nvarchar(256), "refProvision" float, "refFactor" float, "bankTxId" int, "buyId" int, CONSTRAINT "PK_f8243bf386aa594a1b176a54730" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_fff9c3ecb0172beef0a2cdbd74" ON "buy_crypto" ("bankTxId") WHERE "bankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "type" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "type" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_fff9c3ecb0172beef0a2cdbd748" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f" FOREIGN KEY ("buyId") REFERENCES "buy"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_00e1e81f9595e9f65f6c920459f"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP CONSTRAINT "FK_fff9c3ecb0172beef0a2cdbd748"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "type"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "type"`);
        await queryRunner.query(`DROP INDEX "REL_fff9c3ecb0172beef0a2cdbd74" ON "buy_crypto"`);
        await queryRunner.query(`DROP TABLE "buy_crypto"`);
    }
}
