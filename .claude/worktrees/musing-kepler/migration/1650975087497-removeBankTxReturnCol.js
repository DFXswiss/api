const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class removeBankTxReturnCol1650975087497 {
    name = 'removeBankTxReturnCol1650975087497'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_3c264ac8b76bdf550c5870c3562"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP CONSTRAINT "FK_d9926b8052e83c1623a1215bc62"`);
        await queryRunner.query(`DROP INDEX "REL_d9926b8052e83c1623a1215bc6" ON "dbo"."bank_tx"`);
        await queryRunner.query(`DROP INDEX "REL_3c264ac8b76bdf550c5870c356" ON "dbo"."bank_tx"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "returnBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" DROP COLUMN "nextRepeatBankTxId"`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "nextRepeatBankTxId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD "returnBankTxId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_3c264ac8b76bdf550c5870c356" ON "dbo"."bank_tx" ("nextRepeatBankTxId") WHERE ([nextRepeatBankTxId] IS NOT NULL)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_d9926b8052e83c1623a1215bc6" ON "dbo"."bank_tx" ("returnBankTxId") WHERE ([returnBankTxId] IS NOT NULL)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_d9926b8052e83c1623a1215bc62" FOREIGN KEY ("returnBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx" ADD CONSTRAINT "FK_3c264ac8b76bdf550c5870c3562" FOREIGN KEY ("nextRepeatBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }
}
