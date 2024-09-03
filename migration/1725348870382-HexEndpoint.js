const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class HexEndpoint1725348870382 {
    name = 'HexEndpoint1725348870382'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "config" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "tx" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "txId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_quote" ADD "errorMessage" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "user_data" ADD "paymentLinksConfig" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "user_data" DROP COLUMN "paymentLinksConfig"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "errorMessage"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "txId"`);
        await queryRunner.query(`ALTER TABLE "payment_quote" DROP COLUMN "tx"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "config"`);
    }
}
