const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class RefactoringReturnBankTx1648694246010 {
    name = 'RefactoringReturnBankTx1648694246010'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_097e693b22033f81dc3695dd327"`);
        await queryRunner.query(`DROP INDEX "REL_097e693b22033f81dc3695dd32" ON "dbo"."bank_tx"`);
        await queryRunner.query(`EXEC sp_rename "bank_tx.inReturnBankTxId", "returnBankTxId"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_d9926b8052e83c1623a1215bc6" ON "dbo"."bank_tx" ("returnBankTxId") WHERE "returnBankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_d9926b8052e83c1623a1215bc62" FOREIGN KEY ("returnBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_d9926b8052e83c1623a1215bc62"`);
        await queryRunner.query(`DROP INDEX "REL_d9926b8052e83c1623a1215bc6" ON "dbo"."bank_tx"`);
        await queryRunner.query(`EXEC sp_rename "bank_tx.returnBankTxId", "inReturnBankTxId"`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_097e693b22033f81dc3695dd32" ON "dbo"."bank_tx" ("inReturnBankTxId") WHERE ([inReturnBankTxId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_097e693b22033f81dc3695dd327" FOREIGN KEY ("inReturnBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
