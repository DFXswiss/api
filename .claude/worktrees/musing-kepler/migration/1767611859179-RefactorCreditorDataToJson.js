/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class RefactorCreditorDataToJson1767611859179 {
    name = 'RefactorCreditorDataToJson1767611859179'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        // Add new JSON column to buy_crypto
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "chargebackCreditorData" nvarchar(MAX)`);

        // Add new JSON column to bank_tx_return
        await queryRunner.query(`ALTER TABLE "bank_tx_return" ADD "chargebackCreditorData" nvarchar(MAX)`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "bank_tx_return" DROP COLUMN "chargebackCreditorData"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "chargebackCreditorData"`);
    }
}
