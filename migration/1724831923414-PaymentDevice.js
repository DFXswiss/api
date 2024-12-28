const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentDevice1724831923414 {
    name = 'PaymentDevice1724831923414'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "deviceId" nvarchar(256)`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "deviceCommand" nvarchar(MAX)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "deviceCommand"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "deviceId"`);
    }
}
