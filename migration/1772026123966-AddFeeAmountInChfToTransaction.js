/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddFeeAmountInChfToTransaction1772026123966 {
    name = 'AddFeeAmountInChfToTransaction1772026123966'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction" ADD "feeAmountInChf" float`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction" DROP COLUMN "feeAmountInChf"`);
    }
}
