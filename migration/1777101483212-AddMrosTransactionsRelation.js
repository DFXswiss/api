/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddMrosTransactionsRelation1777101483212 {
    name = 'AddMrosTransactionsRelation1777101483212'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`CREATE TABLE "mros_transactions_transaction" ("mrosId" int NOT NULL, "transactionId" int NOT NULL, CONSTRAINT "PK_dd31d8f58065fa662d9e73e5a88" PRIMARY KEY ("mrosId", "transactionId"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1289fce229c942a9404926bf7e" ON "mros_transactions_transaction" ("mrosId")`);
        await queryRunner.query(`CREATE INDEX "IDX_bdacbfc66835232ccf59ead866" ON "mros_transactions_transaction" ("transactionId")`);
        await queryRunner.query(`ALTER TABLE "mros_transactions_transaction" ADD CONSTRAINT "FK_1289fce229c942a9404926bf7ee" FOREIGN KEY ("mrosId") REFERENCES "mros"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
        await queryRunner.query(`ALTER TABLE "mros_transactions_transaction" ADD CONSTRAINT "FK_bdacbfc66835232ccf59ead866b" FOREIGN KEY ("transactionId") REFERENCES "transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "mros_transactions_transaction" DROP CONSTRAINT "FK_bdacbfc66835232ccf59ead866b"`);
        await queryRunner.query(`ALTER TABLE "mros_transactions_transaction" DROP CONSTRAINT "FK_1289fce229c942a9404926bf7ee"`);
        await queryRunner.query(`DROP INDEX "IDX_bdacbfc66835232ccf59ead866" ON "mros_transactions_transaction"`);
        await queryRunner.query(`DROP INDEX "IDX_1289fce229c942a9404926bf7e" ON "mros_transactions_transaction"`);
        await queryRunner.query(`DROP TABLE "mros_transactions_transaction"`);
    }
}
