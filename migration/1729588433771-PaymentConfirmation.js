const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class PaymentConfirmation1729588433771 {
    name = 'PaymentConfirmation1729588433771'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "isConfirmed" bit NOT NULL CONSTRAINT "DF_a2ab5a41f877d988670b7046672" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "DF_a2ab5a41f877d988670b7046672"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "isConfirmed"`);
    }
}
