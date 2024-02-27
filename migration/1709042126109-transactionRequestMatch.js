const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class transactionRequestMatch1709042126109 {
    name = 'transactionRequestMatch1709042126109'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "exactPrice" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_dd79b1062790658e9b73ef69e95" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "transactionRequestId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_40eba1970b47febeab6d8118cd" ON "dbo"."buy_crypto" ("transactionRequestId") WHERE "transactionRequestId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_40eba1970b47febeab6d8118cd3" FOREIGN KEY ("transactionRequestId") REFERENCES ."transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_63bb76ac49a36fef0c9f8503743"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_6a4e7ed37d66dc2c61850254133"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_40eba1970b47febeab6d8118cd3"`);
        await queryRunner.query(`DROP INDEX "REL_40eba1970b47febeab6d8118cd" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "transactionRequestId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "DF_dd79b1062790658e9b73ef69e95"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "isComplete"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "exactPrice"`);
    }
}
