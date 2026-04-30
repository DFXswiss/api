const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class newFeeCol1651145926011 {
    name = 'newFeeCol1651145926011'

    async up(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.fee", "percentFee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "percentFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "absoluteFeeAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`EXEC sp_rename "buy_crypto.percentFee", "fee"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "absoluteFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "percentFeeAmount"`);
    }
}
