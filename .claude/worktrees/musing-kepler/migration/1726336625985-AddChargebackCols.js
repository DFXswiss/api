const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddChargebackCols1726336625985 {
    name = 'AddChargebackCols1726336625985'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "chargebackAllowedDateUser" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "chargebackAmount" float`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackAllowedDateUser" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackAllowedDateUser"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "chargebackAmount"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "chargebackAllowedDateUser"`);
    }
}
