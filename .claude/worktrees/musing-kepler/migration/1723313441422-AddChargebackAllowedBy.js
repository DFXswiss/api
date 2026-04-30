const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddChargebackAllowedBy1723313441422 {
    name = 'AddChargebackAllowedBy1723313441422'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "chargebackAllowedBy" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackAllowedBy" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackAllowedBy"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "chargebackAllowedBy"`);
    }
}
