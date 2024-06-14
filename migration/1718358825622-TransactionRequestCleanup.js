const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class TransactionRequestCleanup1718358825622 {
    name = 'TransactionRequestCleanup1718358825622'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_194787772506f09408efbccbc19"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_40eba1970b47febeab6d8118cd3"`);
        await queryRunner.query(`DROP INDEX "REL_194787772506f09408efbccbc1" ON "dbo"."buy_fiat"`);
        await queryRunner.query(`DROP INDEX "REL_40eba1970b47febeab6d8118cd" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "externalTransactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "transactionRequestId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "externalTransactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "transactionRequestId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "transactionRequestId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "externalTransactionId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "transactionRequestId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "externalTransactionId" nvarchar(256)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_40eba1970b47febeab6d8118cd" ON "dbo"."buy_crypto" ("transactionRequestId") WHERE ([transactionRequestId] IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_194787772506f09408efbccbc1" ON "dbo"."buy_fiat" ("transactionRequestId") WHERE ([transactionRequestId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_40eba1970b47febeab6d8118cd3" FOREIGN KEY ("transactionRequestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_194787772506f09408efbccbc19" FOREIGN KEY ("transactionRequestId") REFERENCES "transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
