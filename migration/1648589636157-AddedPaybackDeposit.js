const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddedPaybackDeposit1648589636157 {
    name = 'AddedPaybackDeposit1648589636157'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD "paybackDepositId" int`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" ADD CONSTRAINT "FK_67d87d80c7fef95e846abc85d1d" FOREIGN KEY ("paybackDepositId") REFERENCES "deposit"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP CONSTRAINT "FK_67d87d80c7fef95e846abc85d1d"`);
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_staking" DROP COLUMN "paybackDepositId"`);
    }
}
