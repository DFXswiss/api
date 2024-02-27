const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class transactionRequestMatch1709047257141 {
    name = 'transactionRequestMatch1709047257141'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "exactPrice" bit NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" ADD "isComplete" bit NOT NULL CONSTRAINT "DF_dd79b1062790658e9b73ef69e95" DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "transactionRequestId" int`);
        await queryRunner.query(`DROP INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "dbo"."deposit"`);
        await queryRunner.query(`DROP INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1" DEFAULT 'Bitcoin' FOR "blockchain"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit" ("accountIndex", "blockchain") WHERE accountIndex IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "dbo"."deposit" ("address", "blockchain") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_40eba1970b47febeab6d8118cd" ON "dbo"."buy_crypto" ("transactionRequestId") WHERE "transactionRequestId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_40eba1970b47febeab6d8118cd3" FOREIGN KEY ("transactionRequestId") REFERENCES ."transaction_request"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_40eba1970b47febeab6d8118cd3"`);
        await queryRunner.query(`DROP INDEX "REL_40eba1970b47febeab6d8118cd" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`DROP INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "dbo"."deposit"`);
        await queryRunner.query(`DROP INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" DROP CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1"`);
        await queryRunner.query(`ALTER TABLE "dbo"."deposit" ADD CONSTRAINT "DF_67c6ed5e4c966de871b836e01f1" DEFAULT 'DeFiChain' FOR "blockchain"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_db718785070d3a28c5493c7b0a" ON "dbo"."deposit" ("accountIndex", "blockchain") WHERE ([accountIndex] IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_aecce3384ad7ae9c11aeb502e4" ON "dbo"."deposit" ("address", "blockchain") `);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "transactionRequestId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP CONSTRAINT "DF_dd79b1062790658e9b73ef69e95"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "isComplete"`);
        await queryRunner.query(`ALTER TABLE "dbo"."transaction_request" DROP COLUMN "exactPrice"`);
    }
}
