const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddPaymentTxCount1724158978862 {
    name = 'AddPaymentTxCount1724158978862'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "txCount" int NOT NULL CONSTRAINT "DF_f1cbd51c47d973ce90ac8b08c8f" DEFAULT 0`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP CONSTRAINT "DF_f1cbd51c47d973ce90ac8b08c8f"`);
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "txCount"`);
    }
}
