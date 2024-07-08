const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddBuyCryptoChargebackIban1719957070772 {
    name = 'AddBuyCryptoChargebackIban1719957070772'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "chargebackIban" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "chargebackIban"`);
    }
}
