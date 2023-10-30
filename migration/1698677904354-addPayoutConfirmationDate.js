const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class addPayoutConfirmationDate1698677904354 {
    name = 'addPayoutConfirmationDate1698677904354'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" ADD "payoutConfirmationDate" datetime2`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" ADD "payoutConfirmationDate" datetime2`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "dbo"."buy_fiat" DROP COLUMN "payoutConfirmationDate"`);
        await queryRunner.query(`ALTER TABLE "dbo"."buy_crypto" DROP COLUMN "payoutConfirmationDate"`);
    }
}
