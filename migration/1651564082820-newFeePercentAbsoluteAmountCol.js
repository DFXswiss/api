const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newFeePercentAbsoluteAmountCol1651564082820 {
    name = 'newFeePercentAbsoluteAmountCol1651564082820'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "feePercentAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "feeAbsolute" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "feeAbsolute"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "feePercentAmount"`);
    }
}
