const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class transactionRequestMatch1709049727775 {
    name = 'transactionRequestMatch1709049727775'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" ADD "exactPrice" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_dd79b1062790658e9b73ef69e95" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ADD "externalTransactionId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ADD "transactionRequestId" int`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" ADD "externalTransactionId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" ADD "transactionRequestId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_40eba1970b47febeab6d8118cd" ON "sqldb-dfx-api-dev"."dbo"."buy_crypto" ("transactionRequestId") WHERE "transactionRequestId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_194787772506f09408efbccbc1" ON "sqldb-dfx-api-dev"."dbo"."buy_fiat" ("transactionRequestId") WHERE "transactionRequestId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" ADD CONSTRAINT "FK_40eba1970b47febeab6d8118cd3" FOREIGN KEY ("transactionRequestId") REFERENCES "sqldb-dfx-api-dev".."transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" ADD CONSTRAINT "FK_194787772506f09408efbccbc19" FOREIGN KEY ("transactionRequestId") REFERENCES "sqldb-dfx-api-dev".."transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" DROP CONSTRAINT "FK_194787772506f09408efbccbc19"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" DROP CONSTRAINT "FK_40eba1970b47febeab6d8118cd3"`);
        await queryRunner.query(`DROP INDEX "REL_194787772506f09408efbccbc1" ON "sqldb-dfx-api-dev"."dbo"."buy_fiat"`);
        await queryRunner.query(`DROP INDEX "REL_40eba1970b47febeab6d8118cd" ON "sqldb-dfx-api-dev"."dbo"."buy_crypto"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" DROP COLUMN "transactionRequestId"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_fiat" DROP COLUMN "externalTransactionId"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" DROP COLUMN "transactionRequestId"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."buy_crypto" DROP COLUMN "externalTransactionId"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" DROP CONSTRAINT "DF_dd79b1062790658e9b73ef69e95"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" DROP COLUMN "isComplete"`);
        await queryRunner.query(`ALTER TABLE "sqldb-dfx-api-dev"."dbo"."transaction_request" DROP COLUMN "exactPrice"`);
    }
}
