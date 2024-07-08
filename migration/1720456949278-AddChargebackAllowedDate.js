const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddChargebackAllowedDate1720456949278 {
    name = 'AddChargebackAllowedDate1720456949278'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "chargebackAllowedDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackAllowedDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackAllowedDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "chargebackAllowedDate"`);
    }
}
