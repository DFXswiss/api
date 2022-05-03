const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newFeeCol1651145926011 {
    name = 'newFeeCol1651145926011'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.fee", "feePercent"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "feePercentAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "feeAbsolute" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.feePercent", "fee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "feeAbsolute"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "feePercentAmount"`);
    }
}
