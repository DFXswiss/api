const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddNetworkStartFeeAmount1719318163610 {
    name = 'AddNetworkStartFeeAmount1719318163610'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "networkStartFeeAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "networkStartFeeAmount"`);
    }
}
