const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedBuyCryptoChargeback1657872324388 {
    name = 'AddedBuyCryptoChargeback1657872324388'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackRemittanceInfo" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackBankTxId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_d46d412c82765cddfc3b5284be" ON "dbo"."buy_crypto" ("chargebackBankTxId") WHERE "chargebackBankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD CONSTRAINT "FK_d46d412c82765cddfc3b5284be6" FOREIGN KEY ("chargebackBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP CONSTRAINT "FK_d46d412c82765cddfc3b5284be6"`);
        await queryRunner.query(`DROP INDEX "REL_d46d412c82765cddfc3b5284be" ON "dbo"."buy_crypto"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackRemittanceInfo"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackDate"`);
    }
}
