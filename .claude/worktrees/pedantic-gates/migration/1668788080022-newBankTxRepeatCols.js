const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newBankTxRepeatCols1668788080022 {
    name = 'newBankTxRepeatCols1668788080022'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "info" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "amountInChf" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "amountInEur" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "amountInUsd" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "sourceBankTxId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "chargebackBankTxId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD "userId" int`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_eada3e39c88717e30da5a48afc" ON "dbo"."bank_tx_repeat" ("sourceBankTxId") WHERE "sourceBankTxId" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "REL_d29f291277c6705c0a79499c2d" ON "dbo"."bank_tx_repeat" ("chargebackBankTxId") WHERE "chargebackBankTxId" IS NOT NULL`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD CONSTRAINT "FK_eada3e39c88717e30da5a48afcf" FOREIGN KEY ("sourceBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD CONSTRAINT "FK_d29f291277c6705c0a79499c2d0" FOREIGN KEY ("chargebackBankTxId") REFERENCES "bank_tx"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" ADD CONSTRAINT "FK_272fc6a981d6fde60688bc4a643" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP CONSTRAINT "FK_272fc6a981d6fde60688bc4a643"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP CONSTRAINT "FK_d29f291277c6705c0a79499c2d0"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP CONSTRAINT "FK_eada3e39c88717e30da5a48afcf"`);
        await queryRunner.query(`DROP INDEX "REL_d29f291277c6705c0a79499c2d" ON "dbo"."bank_tx_repeat"`);
        await queryRunner.query(`DROP INDEX "REL_eada3e39c88717e30da5a48afc" ON "dbo"."bank_tx_repeat"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "userId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "chargebackBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "sourceBankTxId"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "amountInUsd"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "amountInEur"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "amountInChf"`);
        await queryRunner.query(`ALTER TABLE "dbo"."bank_tx_repeat" DROP COLUMN "info"`);
    }
}
