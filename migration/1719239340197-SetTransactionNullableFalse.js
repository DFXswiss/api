const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class SetTransactionNullableFalse1719239340197 {
    name = 'SetTransactionNullableFalse1719239340197'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_f1be1be83e5cd35bb34b5d4c58c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ALTER COLUMN "transactionId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_27bc248ef08405dbdce47daccf6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ALTER COLUMN "transactionId" int NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_f1be1be83e5cd35bb34b5d4c58c" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_27bc248ef08405dbdce47daccf6" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_27bc248ef08405dbdce47daccf6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_f1be1be83e5cd35bb34b5d4c58c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ALTER COLUMN "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_27bc248ef08405dbdce47daccf6" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ALTER COLUMN "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_f1be1be83e5cd35bb34b5d4c58c" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
