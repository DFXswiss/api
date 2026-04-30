/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBankTxRepeatChargeback1764955308556 {
    name = 'AddBankTxRepeatChargeback1764955308556'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackRemittanceInfo" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackAllowedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackAllowedDateUser" datetime2`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackAmount" float`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackAllowedBy" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackIban" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD "chargebackOutputId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_f14912fa9914de7b345f79c21b" ON "bank_tx_repeat" ("chargebackOutputId") WHERE "chargebackOutputId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" ADD CONSTRAINT "FK_f14912fa9914de7b345f79c21bd" FOREIGN KEY ("chargebackOutputId") REFERENCES "fiat_output"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP CONSTRAINT "FK_f14912fa9914de7b345f79c21bd"`);
        await queryRunner.query(`DROP INDEX "REL_f14912fa9914de7b345f79c21b" ON "bank_tx_repeat"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackOutputId"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackIban"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackAllowedBy"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackAmount"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackAllowedDateUser"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackAllowedDate"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackRemittanceInfo"`);
        await queryRunner.query(`ALTER TABLE "bank_tx_repeat" DROP COLUMN "chargebackDate"`);
    }
}
