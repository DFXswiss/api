const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class buyFiatCols1658047296831 {
    name = 'buyFiatCols1658047296831'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "recipientMail" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "mail1SendDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "mail2SendDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "mail3SendDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "inputAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "inputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "inputReferenceAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "inputReferenceAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "amountInChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "amountInEur" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "amlCheck" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "amlReason" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "percentFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "percentFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "absoluteFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "inputReferenceAmountMinusFee" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "cryptoReturnTxId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "cryptoReturnDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "mailReturnSendDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputReferenceAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputReferenceAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputAsset" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "remittanceInfo" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "instantSepa" bit`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "usedBank" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "bankBatchId" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "bankStartTimestamp" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "bankFinishTimestamp" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "info" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "outputDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_08c3846b2a81cc4433512e9f932" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "bankTxId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_8c7b5e695c05e78635b8c0c749" ON "dbo"."buy_fiat" ("bankTxId") WHERE "bankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_8c7b5e695c05e78635b8c0c749f" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_8c7b5e695c05e78635b8c0c749f"`);
        await queryRunner.query(`DROP INDEX "REL_8c7b5e695c05e78635b8c0c749" ON "dbo"."buy_fiat"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "bankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "DF_08c3846b2a81cc4433512e9f932"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "isComplete"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "info"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "bankFinishTimestamp"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "bankStartTimestamp"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "bankBatchId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "usedBank"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "instantSepa"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "remittanceInfo"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputReferenceAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "outputReferenceAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "mailReturnSendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "cryptoReturnDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "cryptoReturnTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "inputReferenceAmountMinusFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "absoluteFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "percentFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "percentFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "amlReason"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "amlCheck"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "amountInEur"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "amountInChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "inputReferenceAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "inputReferenceAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "inputAsset"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "inputAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "mail3SendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "mail2SendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "mail1SendDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "recipientMail"`);
    }
}
