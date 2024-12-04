const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addBankTxReturnChargebackCols1733327830775 {
    name = 'addBankTxReturnChargebackCols1733327830775'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackRemittanceInfo" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackAllowedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackAllowedDateUser" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackAllowedBy" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackIban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "chargebackOutputId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" ADD "userDataId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_58d88e2efe1c42023dd12f11ac" ON "dbo"."bank_tx_return" ("chargebackOutputId") WHERE "chargebackOutputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "bank_tx_return" ADD CONSTRAINT "FK_58d88e2efe1c42023dd12f11aca" FOREIGN KEY ("chargebackOutputId") REFERENCES "fiat_output"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "bank_tx_return" ADD CONSTRAINT "FK_a7125bcc9a433258dc395d6c867" FOREIGN KEY ("userDataId") REFERENCES "user_data"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP CONSTRAINT "FK_a7125bcc9a433258dc395d6c867"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP CONSTRAINT "FK_58d88e2efe1c42023dd12f11aca"`);
        await queryRunner.query(`DROP INDEX "REL_58d88e2efe1c42023dd12f11ac" ON "dbo"."bank_tx_return"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "userDataId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackOutputId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackIban"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackAllowedBy"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackAllowedDateUser"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackAllowedDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackRemittanceInfo"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_return" DROP COLUMN "chargebackDate"`);
    }
}
