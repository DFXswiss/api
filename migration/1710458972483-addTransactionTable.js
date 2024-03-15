const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addTransactionTable1710458972483 {
    name = 'addTransactionTable1710458972483'

    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "transaction" ("id" int NOT NULL IDENTITY(1,1), "updated" datetime2 NOT NULL CONSTRAINT "DF_d0a889b18fcdc8b8baf852781f3" DEFAULT getdate(), "created" datetime2 NOT NULL CONSTRAINT "DF_8abb653ad984db9d9c8c75039e9" DEFAULT getdate(), "sourceType" nvarchar(256) NOT NULL, "type" nvarchar(256), CONSTRAINT "PK_89eadb93a89810556e1cbcd6ab9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "transactionId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "transactionId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_e6761a9f5b7bdb014423698219" ON "dbo"."ref_reward" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_0db4115b72f23b81ed1ee02689" ON "dbo"."bank_tx_repeat" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_d2ae5b105cceecbdade25da502" ON "dbo"."bank_tx_return" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_8e0359f64389286b7bb92a7917" ON "dbo"."checkout_tx" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_f1be1be83e5cd35bb34b5d4c58" ON "dbo"."buy_fiat" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_432b51815e7c473cacc1057150" ON "dbo"."bank_tx" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_27bc248ef08405dbdce47daccf" ON "dbo"."buy_crypto" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_1afbad86764ae5fef44ccde6f6" ON "dbo"."crypto_input" ("transactionId") WHERE "transactionId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" ADD CONSTRAINT "FK_e6761a9f5b7bdb014423698219a" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD CONSTRAINT "FK_0db4115b72f23b81ed1ee026890" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD CONSTRAINT "FK_d2ae5b105cceecbdade25da502a" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" ADD CONSTRAINT "FK_8e0359f64389286b7bb92a79178" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD CONSTRAINT "FK_f1be1be83e5cd35bb34b5d4c58c" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_432b51815e7c473cacc1057150c" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_27bc248ef08405dbdce47daccf6" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD CONSTRAINT "FK_1afbad86764ae5fef44ccde6f6d" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP CONSTRAINT "FK_1afbad86764ae5fef44ccde6f6d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_27bc248ef08405dbdce47daccf6"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_432b51815e7c473cacc1057150c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP CONSTRAINT "FK_f1be1be83e5cd35bb34b5d4c58c"`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP CONSTRAINT "FK_8e0359f64389286b7bb92a79178"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP CONSTRAINT "FK_d2ae5b105cceecbdade25da502a"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP CONSTRAINT "FK_0db4115b72f23b81ed1ee026890"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP CONSTRAINT "FK_e6761a9f5b7bdb014423698219a"`);
        await queryRunner.query(`DROP INDEX "REL_1afbad86764ae5fef44ccde6f6" ON "dbo"."crypto_input"`);
        await queryRunner.query(`DROP INDEX "REL_27bc248ef08405dbdce47daccf" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`DROP INDEX "REL_432b51815e7c473cacc1057150" ON "dbo"."bank_tx"`);
        await queryRunner.query(`DROP INDEX "REL_f1be1be83e5cd35bb34b5d4c58" ON "dbo"."buy_fiat"`);
        await queryRunner.query(`DROP INDEX "REL_8e0359f64389286b7bb92a7917" ON "dbo"."checkout_tx"`);
        await queryRunner.query(`DROP INDEX "REL_d2ae5b105cceecbdade25da502" ON "dbo"."bank_tx_return"`);
        await queryRunner.query(`DROP INDEX "REL_0db4115b72f23b81ed1ee02689" ON "dbo"."bank_tx_repeat"`);
        await queryRunner.query(`DROP INDEX "REL_e6761a9f5b7bdb014423698219" ON "dbo"."ref_reward"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."checkout_tx" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "transactionId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."ref_reward" DROP COLUMN "transactionId"`);
        await queryRunner.query(`DROP TABLE "transaction"`);
    }
}
