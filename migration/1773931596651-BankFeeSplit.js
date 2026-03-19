/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class BankFeeSplit1773931596651 {
    name = 'BankFeeSplit1773931596651'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "bankFixedFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "bankVariableFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "bankFixedFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "bankVariableFeeAmount" float`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "bankVariableFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "bankFixedFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "bankVariableFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "bankFixedFeeAmount"`);
    }
}
