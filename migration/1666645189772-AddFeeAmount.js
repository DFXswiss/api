const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddFeeAmount1666645189772 {
    name = 'AddFeeAmount1666645189772'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "feeAmount" float NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "feeAmount"`);
    }
}
