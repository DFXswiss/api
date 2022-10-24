const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddForwardFeeAmount1666647603152 {
    name = 'AddForwardFeeAmount1666647603152'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" ADD "forwardFeeAmount" float NOT NULL`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."crypto_input" DROP COLUMN "forwardFeeAmount"`);
    }
}
