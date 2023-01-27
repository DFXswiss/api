const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class fiatOutputBankTxChange1674646766576 {
    name = 'fiatOutputBankTxChange1674646766576'

    async up(queryRunner) {
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_cd4cab962216027695e4228596" ON "dbo"."fiat_output" ("bankTxId") WHERE "bankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."fiat_output" ADD CONSTRAINT "FK_cd4cab962216027695e42285968" FOREIGN KEY ("bankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."fiat_output" DROP CONSTRAINT "FK_cd4cab962216027695e42285968"`);
        await queryRunner.query(`DROP INDEX "REL_cd4cab962216027695e4228596" ON "dbo"."fiat_output"`);
    }
}
