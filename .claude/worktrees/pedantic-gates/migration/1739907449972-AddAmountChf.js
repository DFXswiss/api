const { MigrationInterface, QueryRunner } = require("typeorm");

module.exports = class AddAmountChf1739907449972 {
    name = 'AddAmountChf1739907449972'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "exchange_tx" ADD "amountChf" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "exchange_tx" DROP COLUMN "amountChf"`);
    }
}
