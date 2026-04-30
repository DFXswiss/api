/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddModeToPaymentLinkTable1750973273733 {
    name = 'AddModeToPaymentLinkTable1750973273733'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" ADD "mode" nvarchar(256) NOT NULL CONSTRAINT "DF_a09516f7c0897254173b13a5db0" DEFAULT 'Multiple'`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link" DROP CONSTRAINT "DF_a09516f7c0897254173b13a5db0"`);
        await queryRunner.query(`ALTER TABLE "payment_link" DROP COLUMN "mode"`);
    }
}
