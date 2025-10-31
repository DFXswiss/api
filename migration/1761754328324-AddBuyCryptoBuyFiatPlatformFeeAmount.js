/**
 * @typedef {import('typeorm').MigrationInterface} MigrationInterface
 */

/**
 * @class
 * @implements {MigrationInterface}
 */
module.exports = class AddBuyCryptoBuyFiatPlatformFeeAmount1761754328324 {
    name = 'AddBuyCryptoBuyFiatPlatformFeeAmount1761754328324'

    async up(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_fiat" ADD "partnerFeeAmount" float`);
        await queryRunner.query(`ALTER TABLE "buy_crypto" ADD "partnerFeeAmount" float`);
    }

    async down(queryRunner) {
        await queryRunner.query(`ALTER TABLE "buy_crypto" DROP COLUMN "partnerFeeAmount"`);
        await queryRunner.query(`ALTER TABLE "buy_fiat" DROP COLUMN "partnerFeeAmount"`);
    }
}
