/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class PaymentNote1749049390753 {
    name = 'PaymentNote1749049390753'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" ADD "note" nvarchar(256)`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "payment_link_payment" DROP COLUMN "note"`);
    }
}
