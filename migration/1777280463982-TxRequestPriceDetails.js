/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 * @typedef {import('typeorm').QueryRunner} QueryRunner
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class TxRequestPriceDetails1777280463982 {
    name = 'TxRequestPriceDetails1777280463982'

    /**
     * @param {QueryRunner} queryRunner
     */
    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "transaction_request" ADD "fees" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "transaction_request" ADD "priceSteps" nvarchar(MAX)`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "quoteMarketRatio" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "quoteMarketRatio" float`);
    }

    /**
     * @param {QueryRunner} queryRunner
     */
    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "quoteMarketRatio"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "quoteMarketRatio"`);
        await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "priceSteps"`);
        await queryRunner.query(`ALTER TABLE "transaction_request" DROP COLUMN "fees"`);
    }
}
