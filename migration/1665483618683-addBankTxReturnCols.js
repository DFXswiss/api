const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankTxReturnCols1665483618683 {
    name = 'addBankTxReturnCols1665483618683'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "info" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackBankTxId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_bf49a36416f66a9356644c6f21" ON "dbo"."bank_tx_return" ("chargebackBankTxId") WHERE "chargebackBankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD CONSTRAINT "FK_bf49a36416f66a9356644c6f218" FOREIGN KEY ("chargebackBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP CONSTRAINT "FK_bf49a36416f66a9356644c6f218"`);
        await queryRunner.query(`DROP INDEX "REL_bf49a36416f66a9356644c6f21" ON "dbo"."bank_tx_return"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "info"`);
    }
}
